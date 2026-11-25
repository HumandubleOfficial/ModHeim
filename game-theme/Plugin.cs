// ModHeim Game Theme: recolors Valheim's 2D interface (panels, buttons, text) from a theme
// file that the ModHeim launcher writes. Purely visual and client-side. It never reads or
// writes worlds or characters.

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using BepInEx;
using HarmonyLib;
using TMPro;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.UI;

namespace ModHeim.GameTheme
{
    [BepInPlugin(Guid, "ModHeim Game Theme", Version)]
    public class Plugin : BaseUnityPlugin
    {
        public const string Guid = "com.modheim.gametheme";
        public const string Version = "0.1.0";
        public const string ThemeFile = "ModHeim.GameTheme.theme";

        internal static Plugin Instance;

        private enum Kind { None, Panel, Button, Heading, Text }

        private sealed class Entry
        {
            public Graphic Graphic;
            public Color Original;
            public Color Applied;
            public bool HasApplied;
            public Kind Kind;
        }

        private readonly Dictionary<int, Entry> _tracked = new Dictionary<int, Entry>();
        private readonly HashSet<string> _seenSprites = new HashSet<string>();
        private readonly StringBuilder _dump = new StringBuilder();
        private Theme _theme = Theme.Off;
        private string _themePath;
        private string _dumpPath;
        private FileSystemWatcher _watcher;
        private volatile bool _reload;
        private bool _scanPending = true;
        private float _nextDumpFlush;

        private void Awake()
        {
            Instance = this;
            _themePath = Path.Combine(Paths.ConfigPath, ThemeFile);
            _dumpPath = Path.Combine(Paths.BepInExRootPath, "ModHeim.GameTheme.sprites.txt");
            LoadTheme();

            try
            {
                _watcher = new FileSystemWatcher(Paths.ConfigPath, ThemeFile)
                {
                    NotifyFilter = NotifyFilters.LastWrite | NotifyFilters.FileName | NotifyFilters.Size,
                    EnableRaisingEvents = true,
                };
                _watcher.Changed += (_, __) => _reload = true;
                _watcher.Created += (_, __) => _reload = true;
                _watcher.Renamed += (_, __) => _reload = true;
            }
            catch (Exception e)
            {
                Logger.LogWarning($"Live theme reload unavailable: {e.Message}");
            }

            SceneManager.sceneLoaded += (_, __) => _scanPending = true;
            new Harmony(Guid).PatchAll(typeof(Plugin).Assembly);
            Logger.LogInfo($"Theme \"{_theme.Name}\" loaded ({(_theme.Enabled ? "on" : "off")})");
        }

        private void OnDestroy()
        {
            _watcher?.Dispose();
        }

        private void Update()
        {
            if (_reload)
            {
                _reload = false;
                LoadTheme();
                ReapplyAll();
                Logger.LogInfo($"Theme changed to \"{_theme.Name}\"");
            }
            if (_scanPending)
            {
                _scanPending = false;
                // Catch UI that was enabled before our patch went in.
                foreach (var g in Resources.FindObjectsOfTypeAll<Graphic>())
                {
                    if (g != null && g.isActiveAndEnabled) Track(g);
                }
            }
            if (_theme.DumpSprites && _dump.Length > 0 && Time.unscaledTime > _nextDumpFlush)
            {
                _nextDumpFlush = Time.unscaledTime + 10f;
                try
                {
                    File.AppendAllText(_dumpPath, _dump.ToString());
                }
                catch { /* diagnostics only */ }
                _dump.Length = 0;
            }
        }

        private void LoadTheme()
        {
            try
            {
                _theme = File.Exists(_themePath) ? Theme.Parse(File.ReadAllText(_themePath)) : Theme.Off;
            }
            catch (Exception e)
            {
                // the launcher may be mid-write; the watcher fires again when it's done
                Logger.LogWarning($"Couldn't read theme: {e.Message}");
            }
        }

        // ------------------------------------------------------------------ tracking

        internal void Track(Graphic g)
        {
            if (g == null) return;
            var id = g.GetInstanceID();
            if (!_tracked.TryGetValue(id, out var e))
            {
                var kind = Classify(g);
                if (kind == Kind.None) return;
                e = new Entry { Graphic = g, Original = g.color, Kind = kind };
                _tracked[id] = e;
            }
            Apply(e);
        }

        private void ReapplyAll()
        {
            var dead = new List<int>();
            foreach (var kv in _tracked)
            {
                if (kv.Value.Graphic == null) dead.Add(kv.Key);
                else Apply(kv.Value);
            }
            foreach (var id in dead) _tracked.Remove(id);
        }

        private void Apply(Entry e)
        {
            var g = e.Graphic;
            var current = g.color;
            // The game changed this color itself since we last touched it: treat that as the new original.
            if (e.HasApplied && current != e.Applied && current != e.Original) e.Original = current;

            if (!_theme.Enabled)
            {
                if (e.HasApplied && current == e.Applied) g.color = e.Original;
                e.HasApplied = false;
                return;
            }

            Color target;
            switch (e.Kind)
            {
                case Kind.Panel:
                    target = Multiply(e.Original, Color.Lerp(Color.white, _theme.Panel, _theme.PanelStrength));
                    break;
                case Kind.Button:
                    target = Multiply(e.Original, Color.Lerp(Color.white, _theme.Button, _theme.PanelStrength));
                    break;
                case Kind.Heading:
                    target = WithAlpha(_theme.Heading, e.Original.a);
                    break;
                case Kind.Text:
                    target = WithAlpha(Color.Lerp(e.Original, _theme.Text, 0.85f), e.Original.a);
                    break;
                default:
                    return;
            }
            g.color = target;
            e.Applied = g.color;
            e.HasApplied = true;
        }

        private static Color Multiply(Color a, Color b) => new Color(a.r * b.r, a.g * b.g, a.b * b.b, a.a);

        private static Color WithAlpha(Color c, float a) => new Color(c.r, c.g, c.b, a);

        // ------------------------------------------------------------------ classification

        private static readonly string[] PanelWords =
            { "panel", "bkg", "background", "wood", "border", "frame", "tooltip", "dialog", "header", "window", "menu", "slot", "tab" };

        private static readonly string[] SkipWords =
            { "icon", "item", "map", "bar", "fill", "crosshair", "mask", "marker", "pin", "logo", "trophy", "arrow", "check", "knob", "handle" };

        private Kind Classify(Graphic g)
        {
            // Only screen-space UI; leave world-space text (names, damage numbers) alone.
            var canvas = g.canvas;
            if (canvas != null && canvas.renderMode == RenderMode.WorldSpace) return Kind.None;

            if (g is Image img)
            {
                var name = img.sprite != null ? img.sprite.name : "";
                Dump(g, "img", name);
                if (name.Length == 0) return Kind.None;
                var lower = name.ToLowerInvariant();
                if (SkipWords.Any(lower.Contains)) return Kind.None;
                if (lower.Contains("button")) return Kind.Button;
                if (PanelWords.Any(lower.Contains)) return Kind.Panel;
                return Kind.None;
            }

            if (g is TMP_Text text)
            {
                var c = text.color;
                Dump(g, "txt", ColorUtility.ToHtmlStringRGB(c));
                if (IsHeadingOrange(c)) return Kind.Heading;
                if (IsLight(c)) return Kind.Text;
            }
            return Kind.None;
        }

        // Valheim's signature yellow-orange titles
        private static bool IsHeadingOrange(Color c) => c.r > 0.85f && c.g > 0.45f && c.g < 0.88f && c.b < 0.45f;

        private static bool IsLight(Color c)
        {
            var max = Mathf.Max(c.r, Mathf.Max(c.g, c.b));
            var min = Mathf.Min(c.r, Mathf.Min(c.g, c.b));
            return min > 0.78f && max - min < 0.15f;
        }

        private void Dump(Graphic g, string kind, string key)
        {
            if (!_theme.DumpSprites || !_seenSprites.Add(kind + ":" + key)) return;
            _dump.Append(kind).Append('\t').Append(key).Append('\t').Append(PathOf(g.transform)).Append('\n');
        }

        private static string PathOf(Transform t)
        {
            var parts = new List<string>();
            for (var i = 0; t != null && i < 6; i++, t = t.parent) parts.Add(t.name);
            parts.Reverse();
            return string.Join("/", parts);
        }
    }

    internal sealed class Theme
    {
        public string Name = "Off";
        public bool Enabled;
        public Color Panel = Color.white;
        public Color Button = Color.white;
        public Color Heading = new Color(1f, 0.71f, 0.33f);
        public Color Text = Color.white;
        public float PanelStrength = 0.6f;
        public bool DumpSprites;

        public static readonly Theme Off = new Theme();

        /// Format: one "Key = value" per line; colors as #RRGGBB or #RRGGBBAA; '#' or ';' at line start is a comment.
        public static Theme Parse(string text)
        {
            var t = new Theme();
            foreach (var raw in text.Split('\n'))
            {
                var line = raw.Trim();
                if (line.Length == 0 || line.StartsWith(";") || line.StartsWith("//") || line.StartsWith("[")) continue;
                if (line.StartsWith("#") && !line.Contains("=")) continue;
                var eq = line.IndexOf('=');
                if (eq < 0) continue;
                var key = line.Substring(0, eq).Trim().ToLowerInvariant();
                var val = line.Substring(eq + 1).Trim();
                switch (key)
                {
                    case "name": t.Name = val; break;
                    case "enabled": t.Enabled = val.Equals("true", StringComparison.OrdinalIgnoreCase); break;
                    case "panel": t.Panel = ParseColor(val, t.Panel); break;
                    case "button": t.Button = ParseColor(val, t.Button); break;
                    case "heading": t.Heading = ParseColor(val, t.Heading); break;
                    case "text": t.Text = ParseColor(val, t.Text); break;
                    case "panelstrength":
                        if (float.TryParse(val, System.Globalization.NumberStyles.Float,
                                System.Globalization.CultureInfo.InvariantCulture, out var s))
                            t.PanelStrength = Mathf.Clamp01(s);
                        break;
                    case "dumpsprites": t.DumpSprites = val.Equals("true", StringComparison.OrdinalIgnoreCase); break;
                }
            }
            return t;
        }

        private static Color ParseColor(string v, Color fallback)
        {
            if (!v.StartsWith("#")) v = "#" + v;
            return ColorUtility.TryParseHtmlString(v, out var c) ? c : fallback;
        }
    }

    [HarmonyPatch(typeof(Graphic), "OnEnable")]
    internal static class GraphicOnEnablePatch
    {
        private static void Postfix(Graphic __instance)
        {
            try { Plugin.Instance?.Track(__instance); }
            catch { /* never break the game's UI over a color */ }
        }
    }

    [HarmonyPatch(typeof(TextMeshProUGUI), "OnEnable")]
    internal static class TmpOnEnablePatch
    {
        private static void Postfix(TextMeshProUGUI __instance)
        {
            try { Plugin.Instance?.Track(__instance); }
            catch { /* never break the game's UI over a color */ }
        }
    }
}
