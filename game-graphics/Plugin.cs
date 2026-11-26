// ModHeim Graphics: makes Valheim look closer to a modern AAA game by pushing its own renderer
// further than the in-game settings go:
//   - screen-space reflections (built into the game's post-processing, never switched on) and a
//     real-time reflection probe that follows the camera, so water, metal and wet stone reflect
//     what's actually around them;
//   - full-resolution textures, 16x anisotropic filtering, higher model detail at distance;
//   - sharper, longer shadows; stronger ambient occlusion;
//   - ACES filmic tone mapping, colour grading, temporal anti-aliasing with sharpening,
//     optional auto exposure, bloom and vignette; longer grass distance.
// Settings come from a small file the ModHeim launcher writes, and reload live.
// Purely visual and client-side. It never reads or writes worlds or characters.

using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using BepInEx;
using HarmonyLib;
using UnityEngine;
using UnityEngine.PostProcessing;
using UnityEngine.Rendering;
using UnityEngine.SceneManagement;

namespace ModHeim.Graphics
{
    internal sealed class Settings
    {
        public bool Enabled;
        public string Preset = "Off";
        /// 0 off, 1 medium, 2 high, 3 ultra
        public int Reflections;
        public bool ReflectionProbe;
        public int ProbeResolution = 256;
        public bool FullTextures;
        /// 0 = leave the game's setting
        public int Anisotropic;
        /// 0 = leave the game's setting
        public float LodBias;
        /// 0 = leave the game's setting
        public float ShadowDistance;
        /// 0 game, 1 high, 2 very high
        public int ShadowQuality;
        /// 0 game, 1 strong, 2 ultra
        public int AmbientOcclusion;
        /// 0 game, 1 TAA
        public int AntiAliasing;
        public float Sharpen = 0.3f;
        /// Game, ACES, Neutral
        public string Tonemapping = "Game";
        public float Exposure;
        public float Contrast = 1f;
        public float Saturation = 1f;
        public float Temperature;
        /// multiplier on the game's bloom; 1 = unchanged
        public float Bloom = 1f;
        /// -1 = leave the game's setting
        public float Vignette = -1f;
        public bool AutoExposure;
        /// metres; 0 = leave the game's setting
        public float GrassDistance;
        /// cinematic colour wheels: Off, Cinematic, Golden, Nordic, Moody
        public string Grade = "Off";
        public float GradeStrength = 0.5f;
        /// local contrast ("clarity"), 0 = off
        public float Clarity;
        /// 0 game, 1 strong, 2 epic
        public int GodRays;
        /// dithering against banding in skies and fog
        public bool Deband;
        /// 0 = off
        public float FilmGrain;
        /// toggles everything off and on in game, for before/after comparisons
        public string CompareKey = "F9";
        /// 0 game, 1 more, 2 ultra: how many fires and torches light the scene and cast shadows
        public int LightQuality;
        /// multiplier on the game's grass amount; 0 = leave it
        public float GrassDensity;
        public bool GrassShadows;
        /// the game's terrain tessellation (real 3D ground detail)
        public bool Tessellation;
        /// 0..1: sharper textures at a distance (negative mip bias)
        public float TextureSharpness;
        /// 0 game, 1 realistic, 2 ultra: mirror reflections of the world, glassier surface,
        /// stronger refraction, smoother tessellated waves
        public int Water;
        /// multiplier on how far you see into the water; 1 = game's
        public float WaterClarity = 1f;
        /// 0 off (game), 1 subtle, 2 cinematic camera motion blur
        public int MotionBlur;

        public static Settings Parse(string text)
        {
            var s = new Settings();
            foreach (var raw in text.Split('\n'))
            {
                var line = raw.Trim();
                if (line.Length == 0 || line[0] == ';' || line[0] == '#') continue;
                var eq = line.IndexOf('=');
                if (eq < 0) continue;
                var k = line.Substring(0, eq).Trim().ToLowerInvariant();
                var v = line.Substring(eq + 1).Trim();
                switch (k)
                {
                    case "enabled": s.Enabled = Bool(v); break;
                    case "preset": s.Preset = v; break;
                    case "reflections": s.Reflections = Clamp(Int(v), 0, 3); break;
                    case "reflectionprobe": s.ReflectionProbe = Bool(v); break;
                    case "proberesolution": s.ProbeResolution = Clamp(Int(v), 64, 1024); break;
                    case "fulltextures": s.FullTextures = Bool(v); break;
                    case "anisotropic": s.Anisotropic = Clamp(Int(v), 0, 16); break;
                    case "lodbias": s.LodBias = Mathf.Clamp(Float(v), 0f, 6f); break;
                    case "shadowdistance": s.ShadowDistance = Mathf.Clamp(Float(v), 0f, 600f); break;
                    case "shadowquality": s.ShadowQuality = Clamp(Int(v), 0, 2); break;
                    case "ambientocclusion": s.AmbientOcclusion = Clamp(Int(v), 0, 2); break;
                    case "antialiasing": s.AntiAliasing = Clamp(Int(v), 0, 1); break;
                    case "sharpen": s.Sharpen = Mathf.Clamp(Float(v), 0f, 1.5f); break;
                    case "tonemapping": s.Tonemapping = v; break;
                    case "exposure": s.Exposure = Mathf.Clamp(Float(v), -2f, 2f); break;
                    case "contrast": s.Contrast = Mathf.Clamp(Float(v), 0.5f, 1.6f); break;
                    case "saturation": s.Saturation = Mathf.Clamp(Float(v), 0f, 2f); break;
                    case "temperature": s.Temperature = Mathf.Clamp(Float(v), -50f, 50f); break;
                    case "bloom": s.Bloom = Mathf.Clamp(Float(v), 0f, 3f); break;
                    case "vignette": s.Vignette = Mathf.Clamp(Float(v), -1f, 0.6f); break;
                    case "autoexposure": s.AutoExposure = Bool(v); break;
                    case "grassdistance": s.GrassDistance = Mathf.Clamp(Float(v), 0f, 300f); break;
                    case "grade": s.Grade = v; break;
                    case "gradestrength": s.GradeStrength = Mathf.Clamp01(Float(v)); break;
                    case "clarity": s.Clarity = Mathf.Clamp01(Float(v)); break;
                    case "godrays": s.GodRays = Clamp(Int(v), 0, 2); break;
                    case "deband": s.Deband = Bool(v); break;
                    case "filmgrain": s.FilmGrain = Mathf.Clamp(Float(v), 0f, 0.6f); break;
                    case "comparekey": s.CompareKey = v; break;
                    case "lightquality": s.LightQuality = Clamp(Int(v), 0, 2); break;
                    case "grassdensity": s.GrassDensity = Mathf.Clamp(Float(v), 0f, 3f); break;
                    case "grassshadows": s.GrassShadows = Bool(v); break;
                    case "tessellation": s.Tessellation = Bool(v); break;
                    case "texturesharpness": s.TextureSharpness = Mathf.Clamp01(Float(v)); break;
                    case "water": s.Water = Clamp(Int(v), 0, 2); break;
                    case "waterclarity": s.WaterClarity = Mathf.Clamp(Float(v), 0.5f, 3f); break;
                    case "motionblur": s.MotionBlur = Clamp(Int(v), 0, 2); break;
                }
            }
            return s;
        }

        private static bool Bool(string v) => v.Equals("true", StringComparison.OrdinalIgnoreCase) || v == "1";
        private static int Int(string v) => int.TryParse(v, NumberStyles.Integer, CultureInfo.InvariantCulture, out var i) ? i : 0;
        private static float Float(string v) => float.TryParse(v, NumberStyles.Float, CultureInfo.InvariantCulture, out var f) ? f : 0f;
        private static int Clamp(int v, int lo, int hi) => v < lo ? lo : v > hi ? hi : v;
    }

    /// Changes fields on one of the game's camera effects by name, and remembers the game's values
    /// so they can be put back exactly.
    internal sealed class Tweak
    {
        public readonly Behaviour C;
        private readonly Dictionary<string, object> _saved = new Dictionary<string, object>();
        private bool? _enabled;

        public Tweak(Behaviour c) { C = c; }

        public object Orig(string field)
        {
            if (_saved.TryGetValue(field, out var v)) return v;
            return AccessTools.Field(C.GetType(), field)?.GetValue(C);
        }

        public float OrigFloat(string field, float fallback)
        {
            var v = Orig(field);
            return v is float f ? f : fallback;
        }

        public void Set(string field, object value)
        {
            var f = AccessTools.Field(C.GetType(), field);
            if (f == null) return;
            if (!_saved.ContainsKey(field)) _saved[field] = f.GetValue(C);
            object v = f.FieldType.IsEnum ? Enum.ToObject(f.FieldType, Convert.ToInt32(value, CultureInfo.InvariantCulture))
                : Convert.ChangeType(value, f.FieldType, CultureInfo.InvariantCulture);
            if (!Equals(f.GetValue(C), v)) f.SetValue(C, v);
        }

        public void Enable(bool on)
        {
            if (_enabled == null) _enabled = C.enabled;
            if (C.enabled != on) C.enabled = on;
        }

        public void Restore()
        {
            if (C == null) return;
            foreach (var kv in _saved) AccessTools.Field(C.GetType(), kv.Key)?.SetValue(C, kv.Value);
            if (_enabled != null) C.enabled = _enabled.Value;
            _saved.Clear();
            _enabled = null;
        }
    }

    /// Changes game fields (static, or on any object) and remembers every original value, so all of
    /// it can be put back for the before/after key or when the plugin is switched off.
    internal sealed class FieldTweaks
    {
        private readonly Dictionary<KeyValuePair<object, System.Reflection.FieldInfo>, object> _orig =
            new Dictionary<KeyValuePair<object, System.Reflection.FieldInfo>, object>();

        private static KeyValuePair<object, System.Reflection.FieldInfo> Key(object target, System.Reflection.FieldInfo f) =>
            new KeyValuePair<object, System.Reflection.FieldInfo>(target ?? f, f);

        public object Orig(object target, System.Reflection.FieldInfo f)
        {
            if (f == null) return null;
            return _orig.TryGetValue(Key(target, f), out var v) ? v : f.GetValue(f.IsStatic ? null : target);
        }

        public float OrigFloat(object target, System.Reflection.FieldInfo f, float fallback)
        {
            var v = Orig(target, f);
            return v is float x ? x : v is int i ? i : fallback;
        }

        /// true when the value actually changed
        public bool Set(object target, System.Reflection.FieldInfo f, object value)
        {
            if (f == null) return false;
            var on = f.IsStatic ? null : target;
            if (!f.IsStatic && on == null) return false;
            var k = Key(on, f);
            if (!_orig.ContainsKey(k)) _orig[k] = f.GetValue(on);
            object v = f.FieldType.IsEnum ? Enum.ToObject(f.FieldType, Convert.ToInt32(value, CultureInfo.InvariantCulture))
                : Convert.ChangeType(value, f.FieldType, CultureInfo.InvariantCulture);
            if (Equals(f.GetValue(on), v)) return false;
            f.SetValue(on, v);
            return true;
        }

        public void Restore()
        {
            foreach (var kv in _orig)
            {
                var f = kv.Key.Value;
                var target = f.IsStatic ? null : kv.Key.Key;
                if (target is UnityEngine.Object uo && uo == null) continue;
                try { f.SetValue(target, kv.Value); } catch { }
            }
            _orig.Clear();
        }

        /// forget objects the game has destroyed
        public void Prune()
        {
            var dead = new List<KeyValuePair<object, System.Reflection.FieldInfo>>();
            foreach (var k in _orig.Keys)
                if (k.Key is UnityEngine.Object uo && uo == null) dead.Add(k);
            foreach (var k in dead) _orig.Remove(k);
        }
    }

    [BepInPlugin(Guid, "ModHeim Graphics", Version)]
    public class Plugin : BaseUnityPlugin
    {
        public const string Guid = "com.modheim.graphics";
        public const string Version = "0.3.0";
        public const string SettingsFile = "ModHeim.Graphics.preset";

        private Settings _s = new Settings();
        private string _path;
        private FileSystemWatcher _watcher;
        private volatile bool _reload;

        private Camera _cam;
        private PostProcessingBehaviour _post;
        private PostProcessingProfile _gameProfile;
        private PostProcessingProfile _ours;
        private ReflectionProbe _probe;
        private float _nextApply;
        private bool _loggedCamera;

        // the game's own camera effects we push further
        private Tweak _sunShafts;
        private Tweak _amplify;
        private Tweak _clarity;
        private bool _clarityOurs;
        private bool _clarityMissing;

        // world detail: lights, grass, tessellation, texture sharpness
        private readonly FieldTweaks _fields = new FieldTweaks();
        private readonly Dictionary<Light, LightShadowResolution> _lightRes = new Dictionary<Light, LightShadowResolution>();
        private readonly Dictionary<Texture, float> _mipBias = new Dictionary<Texture, float>();
        private readonly List<Material> _tessMats = new List<Material>();
        private bool _tessGlobalWasOn;
        private bool _tessOn;
        private float _nextScan;
        private Light _sun;
        private LightShadows _sunShadows;
        private LightShadowResolution _sunRes;
        private float _sunNormalBias;
        private bool _loggedDetail;

        // before/after compare
        private KeyCode _compareKey = KeyCode.F9;
        private bool _comparing;
        private float _bannerUntil;

        // the game's own values, put back when the plugin is switched off
        private bool _savedQuality;
        private int _mipLimit;
        private AnisotropicFiltering _aniso;
        private float _lodBias;
        private int _maxLod;
        private float _shadowDistance;
        private ShadowResolution _shadowRes;
        private int _cascades;
        private bool _streaming;

        private void Awake()
        {
            _path = Path.Combine(Paths.ConfigPath, SettingsFile);
            Load();
            try
            {
                _watcher = new FileSystemWatcher(Paths.ConfigPath, SettingsFile)
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
                Logger.LogWarning($"Live reload unavailable: {e.Message}");
            }
            SceneManager.sceneLoaded += (_, __) => { _cam = null; _sun = null; _nextScan = 0f; _fields.Prune(); };
            Logger.LogInfo($"Preset \"{_s.Preset}\" ({(_s.Enabled ? "on" : "off")})");
        }

        private void OnDestroy()
        {
            _watcher?.Dispose();
            Restore();
        }

        private void Load()
        {
            try
            {
                _s = File.Exists(_path) ? Settings.Parse(File.ReadAllText(_path)) : new Settings();
            }
            catch (Exception e)
            {
                Logger.LogWarning($"Couldn't read {SettingsFile}: {e.Message}");
                _s = new Settings();
            }
            _compareKey = Enum.TryParse(_s.CompareKey, true, out KeyCode k) && k != KeyCode.None ? k : KeyCode.F9;
            _comparing = false;
        }

        private void CheckCompareKey()
        {
            // plain key only, so Alt/Ctrl combos other mods use don't trigger it
            if (!Input.GetKeyDown(_compareKey)) return;
            if (Input.GetKey(KeyCode.LeftAlt) || Input.GetKey(KeyCode.RightAlt)
                || Input.GetKey(KeyCode.LeftControl) || Input.GetKey(KeyCode.RightControl)) return;
            _comparing = !_comparing;
            _bannerUntil = Time.unscaledTime + 2.5f;
            if (_comparing)
            {
                Restore();
            }
            else
            {
                _cam = null;
                _nextScan = 0f;
                _nextApply = 0f;
            }
        }

        private GUIStyle _banner;

        private void OnGUI()
        {
            if (!_s.Enabled || (!_comparing && Time.unscaledTime > _bannerUntil)) return;
            if (_banner == null)
            {
                _banner = new GUIStyle(GUI.skin.label) { fontSize = 18, alignment = TextAnchor.MiddleCenter, fontStyle = FontStyle.Bold };
                _banner.normal.textColor = new Color(1f, 0.86f, 0.55f);
            }
            var text = _comparing
                ? $"ModHeim Graphics OFF  (game's own look)   ·   {_compareKey} to turn back on"
                : $"ModHeim Graphics ON  ·  \"{_s.Preset}\"";
            var r = new Rect(0, 18, Screen.width, 32);
            var shadow = new Rect(r.x + 1, r.y + 1, r.width, r.height);
            var c = _banner.normal.textColor;
            _banner.normal.textColor = new Color(0, 0, 0, 0.8f);
            GUI.Label(shadow, text, _banner);
            _banner.normal.textColor = c;
            GUI.Label(r, text, _banner);
        }

        private void Update()
        {
            if (_reload)
            {
                _reload = false;
                Load();
                Restore();
                _cam = null;
                _nextScan = 0f;
                _nextApply = 0f;
                Logger.LogInfo($"Preset \"{_s.Preset}\" ({(_s.Enabled ? "on" : "off")})");
            }
            if (!_s.Enabled) return;
            CheckCompareKey();
            if (_comparing) return;

            float now = Time.unscaledTime;
            if (now >= _nextApply)
            {
                // the game re-applies its own graphics settings now and then, so keep ours on top
                _nextApply = now + 1.5f;
                try { Apply(); }
                catch (Exception e) { Logger.LogError($"Apply failed: {e}"); _nextApply = now + 15f; }
            }
        }

        private int _probeRender;

        /// After the camera has moved this frame: place the reflection probe and keep it rendering.
        private void LateUpdate()
        {
            if (!_s.Enabled || _comparing || _probe == null || _cam == null) return;
            var cp = _cam.transform.position;
            if (_s.Water > 0 && WaterLevel(out float level) && cp.y > level + 0.25f)
            {
                // The camera's mirror image under the water plane: a cubemap seen from there,
                // looked up along the reflected view ray, is exactly what a calm water surface
                // reflects. So the water mirrors the real mountains, trees, boats and sky.
                _probe.transform.position = new Vector3(cp.x, 2f * level - cp.y, cp.z);
            }
            else
            {
                _probe.transform.position = cp;
            }
            // time-sliced: one face at a time, a new pass as soon as the last one finished
            if (_probeRender == 0 || _probe.IsFinishedRendering(_probeRender))
                _probeRender = _probe.RenderProbe();
        }

        private bool WaterLevel(out float level)
        {
            level = 30f;
            var zs = AccessTools.TypeByName("ZoneSystem");
            var inst = zs != null ? AccessTools.Field(zs, "s_instance")?.GetValue(null) : null;
            if (inst == null || (inst is UnityEngine.Object o && o == null)) return false;
            if (AccessTools.Field(zs, "m_waterLevel")?.GetValue(inst) is float f) level = f;
            return true;
        }

        // ------------------------------------------------------------ apply

        private void Apply()
        {
            ApplyQuality();
            var cam = Camera.main;
            if (cam == null) return;
            if (cam != _cam)
            {
                _cam = cam;
                _post = cam.GetComponent<PostProcessingBehaviour>();
                _gameProfile = null;
                if (_ours != null) Destroy(_ours);
                _ours = null;
                SetupProbe(cam);
                RestoreCameraEffects();
                _sunShafts = Find(cam, "UnityStandardAssets.ImageEffects.SunShafts");
                _amplify = Find(cam, "AmplifyOcclusionEffect");
                _clarity = Find(cam, "UnityStandardAssets.ImageEffects.ContrastEnhance");
                _clarityMissing = false;
                _loggedCamera = false;
                _loggedDetail = false;
            }
            ApplyCameraEffects(cam);
            ApplyPost(cam);
            ApplySun();
            // world detail: each part on its own, so one game change can't stop the rest
            bool scan = Time.unscaledTime >= _nextScan;
            if (scan) _nextScan = Time.unscaledTime + 20f;
            Try("lights", ApplyLights);
            Try("grass", ApplyGrass);
            Try("water", ApplyWater);
            Try("tessellation", () => ApplyTessellation(scan));
            if (scan) Try("texture sharpness", ApplyTextureSharpness);
            if (scan && !_loggedDetail)
            {
                _loggedDetail = true;
                Logger.LogInfo($"World detail: lights {(_s.LightQuality > 0 ? $"{_lightsSeen} upgraded" : "game")}, " +
                    $"shadow cascades {(_s.ShadowQuality > 0 ? "sharpened" : "game")}, " +
                    $"grass {(_s.GrassDensity > 0f ? $"x{_s.GrassDensity:0.#}" : "game")}{(_s.GrassShadows ? " with shadows" : "")}, " +
                    $"tessellation {(_s.Tessellation ? $"on ({_tessMats.Count} materials)" : "game")}, " +
                    $"textures {(_s.TextureSharpness > 0f ? $"{_mipBias.Count} sharpened" : "game")}, " +
                    $"water {(_s.Water > 0 ? $"{(_s.Water >= 2 ? "ultra" : "realistic")} ({_waterUsage.Count} surfaces, mirror reflections {(_probe != null ? "on" : "off")})" : "game")}, " +
                    $"motion blur {(_s.MotionBlur > 0 ? (_s.MotionBlur >= 2 ? "cinematic" : "subtle") : "game")}.");
            }
        }

        private void SaveQuality()
        {
            if (_savedQuality) return;
            _savedQuality = true;
            _mipLimit = QualitySettings.globalTextureMipmapLimit;
            _aniso = QualitySettings.anisotropicFiltering;
            _lodBias = QualitySettings.lodBias;
            _maxLod = QualitySettings.maximumLODLevel;
            _shadowDistance = QualitySettings.shadowDistance;
            _shadowRes = QualitySettings.shadowResolution;
            _cascades = QualitySettings.shadowCascades;
            _cascadeSplit = QualitySettings.shadowCascade4Split;
            _streaming = QualitySettings.streamingMipmapsActive;
        }

        private Vector3 _cascadeSplit;

        private void ApplyQuality()
        {
            SaveQuality();
            if (_s.FullTextures)
            {
                // changing these reloads textures, so only touch them when they differ
                if (QualitySettings.globalTextureMipmapLimit != 0) QualitySettings.globalTextureMipmapLimit = 0;
                if (QualitySettings.streamingMipmapsActive) QualitySettings.streamingMipmapsActive = false;
                if (QualitySettings.maximumLODLevel != 0) QualitySettings.maximumLODLevel = 0;
            }
            if (_s.Anisotropic > 0)
            {
                QualitySettings.anisotropicFiltering = AnisotropicFiltering.ForceEnable;
                Texture.SetGlobalAnisotropicFilteringLimits(_s.Anisotropic, _s.Anisotropic);
            }
            if (_s.LodBias > 0f && !Mathf.Approximately(QualitySettings.lodBias, _s.LodBias)) QualitySettings.lodBias = _s.LodBias;
            if (_s.ShadowDistance > 0f) QualitySettings.shadowDistance = _s.ShadowDistance;
            if (_s.ShadowQuality > 0)
            {
                QualitySettings.shadowResolution = _s.ShadowQuality >= 2 ? ShadowResolution.VeryHigh : ShadowResolution.High;
                QualitySettings.shadowCascades = 4;
                QualitySettings.shadowProjection = ShadowProjection.StableFit;
                // A long shadow distance with Unity's default splits stretches the closest cascade
                // over tens of metres and blurs every shadow near you. Fix the cascades in metres
                // instead: ~8 m of razor-sharp shadow, then 25 m, 75 m, and the rest.
                float d = Mathf.Max(QualitySettings.shadowDistance, 20f);
                float a = Mathf.Clamp(8f / d, 0.015f, 0.25f);
                float b = Mathf.Clamp(25f / d, a + 0.02f, 0.5f);
                float c = Mathf.Clamp(75f / d, b + 0.05f, 0.85f);
                var split = new Vector3(a, b, c);
                if (QualitySettings.shadowCascade4Split != split) QualitySettings.shadowCascade4Split = split;
            }
        }

        /// Valheim's sun isn't always RenderSettings.sun, so look for the brightest directional light.
        private Light FindSun()
        {
            if (_sun != null) return _sun;
            var sun = RenderSettings.sun;
            if (sun == null || sun.type != LightType.Directional)
            {
                sun = null;
                foreach (var l in FindObjectsByType<Light>(FindObjectsSortMode.None))
                    if (l.type == LightType.Directional && l.shadows != LightShadows.None && (sun == null || l.intensity > sun.intensity)) sun = l;
            }
            if (sun != null)
            {
                _sun = sun;
                _sunShadows = sun.shadows;
                _sunRes = sun.shadowResolution;
                _sunNormalBias = sun.shadowNormalBias;
            }
            return sun;
        }

        private void ApplySun()
        {
            if (_s.ShadowQuality == 0) return;
            var sun = FindSun();
            if (sun == null) return;
            if (sun.shadows != LightShadows.None && sun.shadows != LightShadows.Soft) sun.shadows = LightShadows.Soft;
            var res = _s.ShadowQuality >= 2 ? LightShadowResolution.VeryHigh : LightShadowResolution.High;
            if (sun.shadowResolution != res) sun.shadowResolution = res;
            // sharper cascades need less normal bias, so shadows sit tight under objects
            float nb = Mathf.Min(_sunNormalBias, _s.ShadowQuality >= 2 ? 0.25f : 0.35f);
            if (!Mathf.Approximately(sun.shadowNormalBias, nb)) sun.shadowNormalBias = nb;
        }

        // ------------------------------------------------------------ world detail

        private readonly HashSet<string> _failed = new HashSet<string>();

        private void Try(string what, Action a)
        {
            if (_failed.Contains(what)) return;
            try { a(); }
            catch (Exception e)
            {
                // log once and stop trying that part, instead of spamming every 1.5 s
                _failed.Add(what);
                Logger.LogWarning($"{what} unavailable: {e.GetType().Name}: {e.Message}");
            }
        }

        private static System.Collections.IEnumerable StaticList(Type t, string field)
        {
            var f = AccessTools.Field(t, field);
            if (f != null && f.IsStatic) return f.GetValue(null) as System.Collections.IEnumerable;
            var p = AccessTools.Property(t, field);
            return p?.GetGetMethod(true)?.IsStatic == true ? p.GetValue(null, null) as System.Collections.IEnumerable : null;
        }

        /// More fires and torches light the scene and cast shadows, from further away.
        private void ApplyLights()
        {
            if (_s.LightQuality == 0) return;
            var t = AccessTools.TypeByName("LightLod");
            if (t == null) return;
            bool ultra = _s.LightQuality >= 2;
            var lightLimit = AccessTools.Field(t, "m_lightLimit");
            var shadowLimit = AccessTools.Field(t, "m_shadowLimit");
            var lightDist = AccessTools.Field(t, "m_lightDistance");
            var shadowDist = AccessTools.Field(t, "m_shadowDistance");
            var lightField = AccessTools.Field(t, "m_light");
            int wantLights = ultra ? 64 : 32, wantShadows = ultra ? 12 : 6;
            float mul = ultra ? 2f : 1.5f;

            void Limits(object target)
            {
                if (lightLimit != null) _fields.Set(target, lightLimit, Math.Max((int)_fields.OrigFloat(target, lightLimit, 0f), wantLights));
                if (shadowLimit != null) _fields.Set(target, shadowLimit, Math.Max((int)_fields.OrigFloat(target, shadowLimit, 0f), wantShadows));
            }
            if (lightLimit?.IsStatic == true || shadowLimit?.IsStatic == true) Limits(null);

            var list = StaticList(t, "m_lights");
            if (list == null) return;
            int n = 0;
            foreach (var lod in list)
            {
                if (lod == null || (lod is UnityEngine.Object uo && uo == null)) continue;
                n++;
                if (lightLimit?.IsStatic == false || shadowLimit?.IsStatic == false) Limits(lod);
                if (lightDist != null) _fields.Set(lod, lightDist, _fields.OrigFloat(lod, lightDist, 40f) * mul);
                if (shadowDist != null) _fields.Set(lod, shadowDist, _fields.OrigFloat(lod, shadowDist, 20f) * mul);
                if (lightField?.GetValue(lod) is Light l && l != null)
                {
                    if (!_lightRes.ContainsKey(l)) _lightRes[l] = l.shadowResolution;
                    var res = ultra ? LightShadowResolution.VeryHigh : LightShadowResolution.High;
                    if (l.shadowResolution != res) l.shadowResolution = res;
                }
            }
            _lightsSeen = n;
        }

        private int _lightsSeen;

        /// Thicker, further grass, optionally casting shadows.
        private void ApplyGrass()
        {
            var type = AccessTools.TypeByName("ClutterSystem");
            if (type == null) return;
            var inst = AccessTools.Field(type, "m_instance")?.GetValue(null);
            if (inst != null && (!(inst is UnityEngine.Object io) || io != null))
            {
                bool changed = false;
                var dist = AccessTools.Field(type, "m_distance");
                if (_s.GrassDistance > 0f && dist != null)
                    changed |= _fields.Set(inst, dist, Mathf.Max(_fields.OrigFloat(inst, dist, 0f), _s.GrassDistance));
                var amount = AccessTools.Field(type, "m_amountScale");
                if (_s.GrassDensity > 0f && amount != null)
                    changed |= _fields.Set(inst, amount, _fields.OrigFloat(inst, amount, 1f) * _s.GrassDensity);
                // the game rebuilds its grass patches on its own when this is set
                if (changed) _fields.Set(inst, AccessTools.Field(type, "m_forceRebuild"), true);
            }

            if (_s.GrassShadows)
            {
                var ir = AccessTools.TypeByName("InstanceRenderer");
                var cast = ir != null ? AccessTools.Field(ir, "m_shadowCasting") : null;
                var all = ir != null ? StaticList(ir, "Instances") : null;
                if (cast != null && all != null)
                    foreach (var r in all)
                        if (r is UnityEngine.Object ro && ro != null) _fields.Set(r, cast, (int)ShadowCastingMode.On);
            }
        }

        /// Valheim's own terrain tessellation: real 3D detail on the ground instead of a flat texture.
        private void ApplyTessellation(bool rescan)
        {
            if (!_s.Tessellation) return;
            const string kw = "TESSELATION_ON";
            if (!_tessOn)
            {
                _tessOn = true;
                _tessGlobalWasOn = Shader.IsKeywordEnabled(kw);
            }
            if (!Shader.IsKeywordEnabled(kw)) Shader.EnableKeyword(kw);
            if (!rescan) return;
            // and on the materials of the shaders the game marks as tessellating
            var gsm = AccessTools.TypeByName("GraphicsSettingsManager");
            var holder = gsm != null ? AccessTools.Field(gsm, "s_instance")?.GetValue(null) : null;
            var shadersObj = gsm != null ? AccessTools.Field(gsm, "m_tesselationShaders")?.GetValue(holder) : null;
            var shaders = new HashSet<Shader>();
            if (shadersObj is System.Collections.IEnumerable e)
                foreach (var o in e)
                {
                    if (o is Shader sh && sh != null) shaders.Add(sh);
                    else if (o is Material m && m != null && m.shader != null) shaders.Add(m.shader);
                }
            if (shaders.Count == 0) return;
            foreach (var m in Resources.FindObjectsOfTypeAll<Material>())
            {
                if (m == null || m.shader == null || !shaders.Contains(m.shader) || m.IsKeywordEnabled(kw)) continue;
                m.EnableKeyword(kw);
                _tessMats.Add(m);
            }
        }

        /// Sharper textures at a distance: a negative mip bias picks a more detailed mip level.
        /// TAA hides the shimmer this would otherwise add.
        private void ApplyTextureSharpness()
        {
            if (_s.TextureSharpness <= 0f) return;
            float bias = -0.8f * _s.TextureSharpness;
            foreach (var t in Resources.FindObjectsOfTypeAll<Texture2D>())
            {
                if (t == null || t.mipmapCount <= 1) continue;
                if (!_mipBias.ContainsKey(t)) _mipBias[t] = t.mipMapBias;
                float want = _mipBias[t] + bias;
                if (!Mathf.Approximately(t.mipMapBias, want)) t.mipMapBias = want;
            }
        }

        private void RestoreDetail()
        {
            _fields.Restore();
            RestoreWater();
            foreach (var kv in _lightRes) if (kv.Key != null) kv.Key.shadowResolution = kv.Value;
            _lightRes.Clear();
            foreach (var kv in _mipBias) if (kv.Key != null) kv.Key.mipMapBias = kv.Value;
            _mipBias.Clear();
            if (_tessOn)
            {
                foreach (var m in _tessMats) if (m != null) m.DisableKeyword("TESSELATION_ON");
                _tessMats.Clear();
                if (!_tessGlobalWasOn) Shader.DisableKeyword("TESSELATION_ON");
                _tessOn = false;
            }
            if (_sun != null)
            {
                _sun.shadows = _sunShadows;
                _sun.shadowResolution = _sunRes;
                _sun.shadowNormalBias = _sunNormalBias;
            }
            _sun = null;
            // grass picks the game's values back up on its next rebuild
            var type = AccessTools.TypeByName("ClutterSystem");
            var inst = type != null ? AccessTools.Field(type, "m_instance")?.GetValue(null) : null;
            if (inst != null) AccessTools.Field(type, "m_forceRebuild")?.SetValue(inst, true);
        }

        private void ApplyPost(Camera cam)
        {
            if (_post == null) return;
            if (_post.profile == null) return;
            // work on a private copy so switching off restores the game's profile untouched
            if (_post.profile != _ours)
            {
                _gameProfile = _post.profile;
                if (_ours != null) Destroy(_ours);
                _ours = Instantiate(_gameProfile);
                _ours.name = _gameProfile.name + " (ModHeim)";
                _post.profile = _ours;
            }
            var p = _ours;

            // reflections
            var ssr = p.screenSpaceReflection;
            ssr.enabled = _s.Reflections > 0;
            if (_s.Reflections > 0)
            {
                var r = ssr.settings;
                r.reflection.blendType = ScreenSpaceReflectionModel.SSRReflectionBlendType.PhysicallyBased;
                r.reflection.reflectionQuality = _s.Reflections >= 3 ? ScreenSpaceReflectionModel.SSRResolution.High : ScreenSpaceReflectionModel.SSRResolution.Low;
                r.reflection.maxDistance = _s.Reflections >= 2 ? 150f : 80f;
                r.reflection.iterationCount = _s.Reflections >= 3 ? 256 : _s.Reflections == 2 ? 192 : 96;
                r.reflection.stepSize = _s.Reflections >= 3 ? 3 : 4;
                r.reflection.widthModifier = 0.5f;
                r.reflection.reflectionBlur = 1f;
                r.reflection.reflectBackfaces = false;
                r.intensity.reflectionMultiplier = 1f;
                r.intensity.fadeDistance = 100f;
                r.intensity.fresnelFade = 1f;
                r.intensity.fresnelFadePower = 1f;
                r.screenEdgeMask.intensity = 0.03f;
                ssr.settings = r;
            }

            // ambient occlusion: the game's Amplify Occlusion is better, so only fall back to the
            // post-processing one when the camera hasn't got it (never both: that doubles the shading)
            if (_s.AmbientOcclusion > 0 && _amplify == null)
            {
                var ao = p.ambientOcclusion;
                ao.enabled = true;
                var a = ao.settings;
                a.intensity = _s.AmbientOcclusion >= 2 ? 1.3f : 1f;
                a.radius = 0.35f;
                a.sampleCount = _s.AmbientOcclusion >= 2 ? AmbientOcclusionModel.SampleCount.High : AmbientOcclusionModel.SampleCount.Medium;
                a.downsampling = _s.AmbientOcclusion < 2;
                a.highPrecision = _s.AmbientOcclusion >= 2;
                ao.settings = a;
            }

            // anti-aliasing
            if (_s.AntiAliasing > 0)
            {
                var aa = p.antialiasing;
                aa.enabled = true;
                var s = aa.settings;
                s.method = AntialiasingModel.Method.Taa;
                s.taaSettings.jitterSpread = 0.75f;
                s.taaSettings.sharpen = _s.Sharpen;
                s.taaSettings.stationaryBlending = 0.95f;
                s.taaSettings.motionBlending = 0.85f;
                aa.settings = s;
            }

            // colour grading, relative to what the game set
            var game = _gameProfile;
            var cg = p.colorGrading;
            var gameCg = game.colorGrading.settings;
            bool gradeOn = game.colorGrading.enabled;
            var c = cg.settings;
            if (_s.Tonemapping.Equals("ACES", StringComparison.OrdinalIgnoreCase))
            {
                c.tonemapping.tonemapper = ColorGradingModel.Tonemapper.ACES;
                gradeOn = true;
            }
            else if (_s.Tonemapping.Equals("Neutral", StringComparison.OrdinalIgnoreCase))
            {
                c.tonemapping.tonemapper = ColorGradingModel.Tonemapper.Neutral;
                gradeOn = true;
            }
            else
            {
                c.tonemapping.tonemapper = gameCg.tonemapping.tonemapper;
            }
            bool grading = !Mathf.Approximately(_s.Exposure, 0f) || !Mathf.Approximately(_s.Contrast, 1f)
                || !Mathf.Approximately(_s.Saturation, 1f) || !Mathf.Approximately(_s.Temperature, 0f);
            gradeOn |= grading;
            var look = Look(_s.Grade);
            if (look != null && _s.GradeStrength > 0f)
            {
                // colour wheels: tint shadows, mid-tones and highlights separately, like a film grade
                float k = _s.GradeStrength;
                c.colorWheels.mode = ColorGradingModel.ColorWheelMode.Linear;
                c.colorWheels.linear.lift = Wheel(look[0], k);
                c.colorWheels.linear.gamma = Wheel(look[1], k);
                c.colorWheels.linear.gain = Wheel(look[2], k);
                gradeOn = true;
            }
            float baseContrast = game.colorGrading.enabled ? gameCg.basic.contrast : 1f;
            float baseSaturation = game.colorGrading.enabled ? gameCg.basic.saturation : 1f;
            c.basic.postExposure = gameCg.basic.postExposure + _s.Exposure;
            c.basic.contrast = baseContrast * _s.Contrast;
            c.basic.saturation = baseSaturation * _s.Saturation;
            c.basic.temperature = gameCg.basic.temperature + _s.Temperature;
            cg.enabled = gradeOn;
            cg.settings = c;

            // bloom, relative to the game's
            var bloom = p.bloom;
            if (!Mathf.Approximately(_s.Bloom, 1f))
            {
                var b = bloom.settings;
                b.bloom.intensity = game.bloom.settings.bloom.intensity * _s.Bloom;
                bloom.settings = b;
                if (_s.Bloom <= 0f) bloom.enabled = false;
            }

            // vignette
            if (_s.Vignette >= 0f)
            {
                var v = p.vignette;
                v.enabled = _s.Vignette > 0f;
                var vs = v.settings;
                vs.intensity = _s.Vignette;
                v.settings = vs;
            }

            // auto exposure: the eye adjusting between bright days and dark caves
            if (_s.AutoExposure)
            {
                var ea = p.eyeAdaptation;
                ea.enabled = true;
                var e = ea.settings;
                e.lowPercent = 45f;
                e.highPercent = 95f;
                e.minLuminance = -4f;
                e.maxLuminance = 2f;
                e.keyValue = 0.25f;
                e.dynamicKeyValue = true;
                e.adaptationType = EyeAdaptationModel.EyeAdaptationType.Progressive;
                e.speedUp = 2f;
                e.speedDown = 1f;
                ea.settings = e;
            }

            // smooth gradients in skies and fog instead of visible bands
            if (_s.Deband) p.dithering.enabled = true;

            // camera motion blur, like a real camera's shutter (180° is film standard)
            if (_s.MotionBlur > 0)
            {
                var mb = p.motionBlur;
                mb.enabled = true;
                var ms = mb.settings;
                ms.shutterAngle = _s.MotionBlur >= 2 ? 270f : 180f;
                ms.sampleCount = _s.MotionBlur >= 2 ? 16 : 10;
                ms.frameBlending = 0f;
                mb.settings = ms;
            }

            // film grain: fine, luminance-weighted, so it reads as texture rather than noise
            if (_s.FilmGrain > 0f)
            {
                var g = p.grain;
                g.enabled = true;
                var gs = g.settings;
                gs.intensity = _s.FilmGrain;
                gs.size = 1.1f;
                gs.luminanceContribution = 0.75f;
                gs.colored = false;
                g.settings = gs;
            }

            if (!_loggedCamera)
            {
                _loggedCamera = true;
                var path = cam.actualRenderingPath;
                Logger.LogInfo($"Camera \"{cam.name}\": {path} rendering, HDR {cam.allowHDR}. " +
                    $"Reflections {(_s.Reflections > 0 ? (path == RenderingPath.DeferredShading ? "on" : "need deferred rendering, so only the reflection probe works") : "off")}, " +
                    $"probe {(_probe != null ? "on" : "off")}, textures {(_s.FullTextures ? "full" : "game")}, AA {(_s.AntiAliasing > 0 ? "TAA" : "game")}, " +
                    $"grade {(look != null ? _s.Grade : "game")}, god rays {(_s.GodRays > 0 ? (_sunShafts != null ? "on" : "unavailable") : "game")}, " +
                    $"AO {(_s.AmbientOcclusion > 0 ? (_amplify != null ? "Amplify" : "post") : "game")}, " +
                    $"clarity {(_s.Clarity > 0f ? (_clarity != null ? "on" : "unavailable") : "off")}, compare key {_compareKey}.");
            }
        }

        // ------------------------------------------------------------ the game's camera effects

        private static Tweak Find(Camera cam, string typeName)
        {
            var t = AccessTools.TypeByName(typeName);
            if (t == null) return null;
            var c = cam.GetComponent(t) as Behaviour;
            return c != null ? new Tweak(c) : null;
        }

        private void ApplyCameraEffects(Camera cam)
        {
            // god rays: Valheim's own sun shafts, stronger and at full resolution
            if (_sunShafts?.C != null && _s.GodRays > 0)
            {
                _sunShafts.Enable(true);
                float mul = _s.GodRays >= 2 ? 1.75f : 1.35f;
                _sunShafts.Set("sunShaftIntensity", _sunShafts.OrigFloat("sunShaftIntensity", 1f) * mul);
                _sunShafts.Set("resolution", 2); // High
                _sunShafts.Set("radialBlurIterations", _s.GodRays >= 2 ? 3 : 2);
                _sunShafts.Set("sunShaftBlurRadius", Mathf.Max(_sunShafts.OrigFloat("sunShaftBlurRadius", 2.5f), _s.GodRays >= 2 ? 4f : 3f));
            }

            // ambient occlusion: the game's Amplify Occlusion with more samples, temporal filtering
            // and a soft blur, so contact shadows sit under rocks, roofs and trees
            if (_amplify?.C != null && _s.AmbientOcclusion > 0)
            {
                bool ultra = _s.AmbientOcclusion >= 2;
                _amplify.Enable(true);
                _amplify.Set("SampleCount", ultra ? 3 : 2); // VeryHigh / High
                _amplify.Set("Intensity", Mathf.Max(_amplify.OrigFloat("Intensity", 1f), ultra ? 1.15f : 1f));
                _amplify.Set("PowerExponent", Mathf.Max(_amplify.OrigFloat("PowerExponent", 1.8f), ultra ? 1.9f : 1.8f));
                _amplify.Set("BlurEnabled", true);
                _amplify.Set("BlurPasses", ultra ? 2 : 1);
                _amplify.Set("FilterEnabled", true);
            }

            // clarity: local contrast, the "pop" ReShade presets get from their clarity shader
            if (_s.Clarity > 0f && _clarity == null && !_clarityMissing)
            {
                var t = AccessTools.TypeByName("UnityStandardAssets.ImageEffects.ContrastEnhance");
                var blur = Shader.Find("Hidden/SeparableBlurPlus");
                var comp = Shader.Find("Hidden/ContrastComposite");
                if (t != null && blur != null && comp != null)
                {
                    var c = (Behaviour)cam.gameObject.AddComponent(t);
                    AccessTools.Field(t, "separableBlurShader")?.SetValue(c, blur);
                    AccessTools.Field(t, "contrastCompositeShader")?.SetValue(c, comp);
                    _clarity = new Tweak(c);
                    _clarityOurs = true;
                }
                else
                {
                    _clarityMissing = true;
                }
            }
            if (_clarity?.C != null)
            {
                if (_s.Clarity > 0f)
                {
                    _clarity.Enable(true);
                    _clarity.Set("intensity", _s.Clarity * 0.9f);
                    _clarity.Set("threshold", 0f);
                    _clarity.Set("blurSpread", 1f);
                }
                else if (_clarityOurs)
                {
                    _clarity.Enable(false);
                }
            }
        }

        private void RestoreCameraEffects()
        {
            _sunShafts?.Restore();
            _amplify?.Restore();
            if (_clarity != null)
            {
                if (_clarityOurs) { if (_clarity.C != null) Destroy(_clarity.C); }
                else _clarity.Restore();
            }
            _sunShafts = _amplify = _clarity = null;
            _clarityOurs = false;
        }

        /// Colour-wheel looks: lift (shadows), gamma (mid-tones), gain (highlights). The colour sets
        /// the tint and alpha the brightness offset, as in Unity's colour-wheel grading.
        private static Color[] Look(string name)
        {
            switch ((name ?? "").ToLowerInvariant())
            {
                // teal shadows, warm skin and fire: the blockbuster grade
                case "cinematic": return new[] { new Color(0.78f, 1.0f, 1.18f, -0.02f), new Color(1.03f, 1.0f, 0.97f, 0f), new Color(1.14f, 1.0f, 0.84f, 0.02f) };
                // low sun on everything: honey highlights, warm mid-tones
                case "golden": return new[] { new Color(1.04f, 0.96f, 1.0f, 0f), new Color(1.09f, 1.0f, 0.88f, 0.02f), new Color(1.15f, 1.02f, 0.84f, 0.03f) };
                // cold northern light: steel-blue shadows, clean whites
                case "nordic": return new[] { new Color(0.84f, 0.95f, 1.2f, -0.01f), new Color(0.96f, 1.0f, 1.07f, 0f), new Color(0.98f, 1.0f, 1.04f, 0.01f) };
                // deep blacks, green-teal shadows, muted highlights
                case "moody": return new[] { new Color(0.82f, 1.05f, 1.04f, -0.05f), new Color(1.0f, 1.0f, 1.0f, -0.03f), new Color(1.05f, 1.0f, 0.93f, 0f) };
                default: return null;
            }
        }

        private static Color Wheel(Color look, float strength)
        {
            // white means "no tint", so strength moves the tint from white towards the look
            var c = Color.Lerp(Color.white, look, strength);
            c.a = look.a * strength;
            return c;
        }

        private void SetupProbe(Camera cam)
        {
            if (_probe != null) Destroy(_probe.gameObject);
            _probe = null;
            // realistic water needs the probe too: it's what the water reflects
            if (!_s.ReflectionProbe && _s.Water == 0) return;
            var go = new GameObject("ModHeim Reflection Probe");
            // not parented: LateUpdate places it every frame (at the camera, or mirrored under the water)
            go.transform.position = cam.transform.position;
            var probe = go.AddComponent<ReflectionProbe>();
            probe.mode = ReflectionProbeMode.Realtime;
            probe.refreshMode = ReflectionProbeRefreshMode.ViaScripting;
            probe.timeSlicingMode = ReflectionProbeTimeSlicingMode.IndividualFaces;
            int res = Mathf.ClosestPowerOfTwo(_s.ProbeResolution);
            if (_s.Water >= 2) res = Mathf.Max(res, 512);
            else if (_s.Water == 1) res = Mathf.Max(res, 256);
            probe.resolution = res;
            probe.size = new Vector3(3000f, 3000f, 3000f);
            probe.importance = 1000;
            probe.boxProjection = false;
            probe.hdr = true;
            probe.shadowDistance = 40f;
            probe.nearClipPlane = 0.3f;
            probe.farClipPlane = 800f;
            probe.clearFlags = ReflectionProbeClearFlags.Skybox;
            // skip UI, and the water itself (a mirror can't reflect its own surface)
            int mask = cam.cullingMask & ~(1 << 5);
            int water = LayerMask.NameToLayer("Water");
            if (water >= 0) mask &= ~(1 << water);
            probe.cullingMask = mask;
            probe.blendDistance = 0f;
            _probe = probe;
            _probeRender = 0;
        }

        // ------------------------------------------------------------ water

        private readonly Dictionary<Material, Dictionary<string, float>> _waterSaved = new Dictionary<Material, Dictionary<string, float>>();
        private readonly Dictionary<Renderer, ReflectionProbeUsage> _waterUsage = new Dictionary<Renderer, ReflectionProbeUsage>();
        private string _waterReport;

        /// Valheim's water shader (Custom/Water) at settings closer to real water: a glassy surface
        /// that mirrors the world through the probe, stronger refraction of what's underneath,
        /// clearer depth, and finer tessellation for smoother wave shapes. Wave heights are left
        /// alone: boats and swimming follow the game's own wave maths.
        private void ApplyWater()
        {
            if (_s.Water == 0) return;
            var t = AccessTools.TypeByName("WaterVolume");
            var surf = t != null ? AccessTools.Field(t, "m_waterSurface") : null;
            var list = t != null ? StaticList(t, "Instances") : null;
            if (surf == null || list == null) return;
            bool ultra = _s.Water >= 2;
            var report = new List<string>();
            foreach (var wv in list)
            {
                if (!(wv is UnityEngine.Object o) || o == null) continue;
                if (!(surf.GetValue(wv) is Renderer r) || r == null) continue;
                if (!_waterUsage.ContainsKey(r)) _waterUsage[r] = r.reflectionProbeUsage;
                if (r.reflectionProbeUsage != ReflectionProbeUsage.BlendProbesAndSkybox) r.reflectionProbeUsage = ReflectionProbeUsage.BlendProbesAndSkybox;
                foreach (var m in r.sharedMaterials)
                {
                    if (m == null || m.shader == null || m.shader.name.IndexOf("Water", StringComparison.OrdinalIgnoreCase) < 0) continue;
                    WaterFloat(m, "_Glossiness", g => Mathf.Max(g, ultra ? 0.97f : 0.93f), report);
                    WaterFloat(m, "_RefractionScale", g => g * (ultra ? 1.6f : 1.3f), report);
                    WaterFloat(m, "_RefractionMax", g => g * (ultra ? 1.4f : 1.2f), report);
                    WaterFloat(m, "_DepthFade", g => g * _s.WaterClarity, report);
                    WaterFloat(m, "_Tess", g => Mathf.Min(g * (ultra ? 2f : 1.5f), 64f), report);
                    WaterFloat(m, "_VisibleMaxDistance", g => g * (ultra ? 1.6f : 1.3f), report);
                }
            }
            if (_waterReport == null && report.Count > 0)
            {
                _waterReport = string.Join(", ", report.ToArray());
                Logger.LogInfo($"Water: {_waterReport}");
            }
        }

        private void WaterFloat(Material m, string name, Func<float, float> f, List<string> report)
        {
            var sh = m.shader;
            int idx = sh.FindPropertyIndex(name);
            if (idx < 0) return;
            var ty = sh.GetPropertyType(idx);
            if (ty != UnityEngine.Rendering.ShaderPropertyType.Float && ty != UnityEngine.Rendering.ShaderPropertyType.Range) return;
            if (!_waterSaved.TryGetValue(m, out var saved)) _waterSaved[m] = saved = new Dictionary<string, float>();
            if (!saved.TryGetValue(name, out float orig)) saved[name] = orig = m.GetFloat(name);
            float want = f(orig);
            if (ty == UnityEngine.Rendering.ShaderPropertyType.Range)
            {
                var lim = sh.GetPropertyRangeLimits(idx);
                want = Mathf.Clamp(want, lim.x, lim.y);
            }
            if (!Mathf.Approximately(m.GetFloat(name), want)) m.SetFloat(name, want);
            if (_waterReport == null && report.Count < 12 && !report.Exists(x => x.StartsWith(name)))
                report.Add($"{name} {orig:0.###}→{want:0.###}");
        }

        private void RestoreWater()
        {
            foreach (var kv in _waterSaved)
                if (kv.Key != null)
                    foreach (var p in kv.Value) kv.Key.SetFloat(p.Key, p.Value);
            _waterSaved.Clear();
            foreach (var kv in _waterUsage) if (kv.Key != null) kv.Key.reflectionProbeUsage = kv.Value;
            _waterUsage.Clear();
            _waterReport = null;
        }

        // ------------------------------------------------------------ restore

        private void Restore()
        {
            if (_post != null && _gameProfile != null && _post.profile == _ours) _post.profile = _gameProfile;
            if (_ours != null) Destroy(_ours);
            _ours = null;
            _gameProfile = null;
            if (_probe != null) Destroy(_probe.gameObject);
            _probe = null;
            RestoreCameraEffects();
            if (_savedQuality)
            {
                if (QualitySettings.globalTextureMipmapLimit != _mipLimit) QualitySettings.globalTextureMipmapLimit = _mipLimit;
                QualitySettings.anisotropicFiltering = _aniso;
                Texture.SetGlobalAnisotropicFilteringLimits(1, 16);
                QualitySettings.lodBias = _lodBias;
                QualitySettings.maximumLODLevel = _maxLod;
                QualitySettings.shadowDistance = _shadowDistance;
                QualitySettings.shadowResolution = _shadowRes;
                QualitySettings.shadowCascades = _cascades;
                QualitySettings.shadowCascade4Split = _cascadeSplit;
                QualitySettings.streamingMipmapsActive = _streaming;
                _savedQuality = false;
            }
            try { RestoreDetail(); }
            catch (Exception e) { Logger.LogWarning($"Restoring world detail: {e.Message}"); }
        }
    }
}
