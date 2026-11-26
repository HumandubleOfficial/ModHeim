//! In-game graphics: ModHeim ships a BepInEx plugin (game-graphics/) that pushes Valheim's own
//! renderer further: reflections, full-resolution textures, shadows, tone mapping and
//! anti-aliasing. The launcher writes a small settings file the plugin reloads live.
//! Visual only: nothing here touches worlds or characters.

use serde::{Deserialize, Serialize};

use crate::error::Result;
use crate::profiles::{self, InstalledMod, Profile};

pub const PLUGIN_ID: &str = "ModHeim-Graphics";
pub const PLUGIN_VERSION: &str = "0.2.0";
const PLUGIN_DLL: &[u8] = include_bytes!("../resources/ModHeim.Graphics.dll");
const PLUGIN_REL: &str = "BepInEx/plugins/ModHeim-Graphics/ModHeim.Graphics.dll";
const SETTINGS_REL: &str = "BepInEx/config/ModHeim.Graphics.preset";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Graphics {
    pub enabled: bool,
    pub preset: String,
    /// 0 off, 1 medium, 2 high, 3 ultra
    pub reflections: u8,
    pub reflection_probe: bool,
    pub probe_resolution: u32,
    pub full_textures: bool,
    /// 0 = game's setting
    pub anisotropic: u8,
    /// 0 = game's setting
    pub lod_bias: f32,
    /// 0 = game's setting
    pub shadow_distance: f32,
    /// 0 game, 1 high, 2 very high
    pub shadow_quality: u8,
    /// 0 game, 1 strong, 2 ultra
    pub ambient_occlusion: u8,
    /// 0 game, 1 TAA
    pub anti_aliasing: u8,
    pub sharpen: f32,
    /// "Game", "ACES" or "Neutral"
    pub tonemapping: String,
    pub exposure: f32,
    pub contrast: f32,
    pub saturation: f32,
    pub temperature: f32,
    pub bloom: f32,
    /// -1 = game's setting
    pub vignette: f32,
    pub auto_exposure: bool,
    /// 0 = game's setting
    pub grass_distance: f32,
    /// colour-wheel look: "Off", "Cinematic", "Golden", "Nordic" or "Moody"
    pub grade: String,
    pub grade_strength: f32,
    /// local contrast, 0 = off
    pub clarity: f32,
    /// 0 game, 1 strong, 2 epic
    pub god_rays: u8,
    pub deband: bool,
    /// 0 = off
    pub film_grain: f32,
    /// in-game before/after key (a Unity KeyCode name)
    pub compare_key: String,
}

pub const GRADES: [&str; 5] = ["Off", "Cinematic", "Golden", "Nordic", "Moody"];

impl Default for Graphics {
    fn default() -> Self {
        Graphics {
            enabled: false,
            preset: "Off".into(),
            reflections: 0,
            reflection_probe: false,
            probe_resolution: 256,
            full_textures: false,
            anisotropic: 0,
            lod_bias: 0.0,
            shadow_distance: 0.0,
            shadow_quality: 0,
            ambient_occlusion: 0,
            anti_aliasing: 0,
            sharpen: 0.3,
            tonemapping: "Game".into(),
            exposure: 0.0,
            contrast: 1.0,
            saturation: 1.0,
            temperature: 0.0,
            bloom: 1.0,
            vignette: -1.0,
            auto_exposure: false,
            grass_distance: 0.0,
            grade: "Off".into(),
            grade_strength: 0.5,
            clarity: 0.0,
            god_rays: 0,
            deband: false,
            film_grain: 0.0,
            compare_key: "F9".into(),
        }
    }
}

impl Graphics {
    pub fn to_file(&self) -> String {
        let tonemap = match self.tonemapping.as_str() {
            "ACES" | "Neutral" => self.tonemapping.as_str(),
            _ => "Game",
        };
        let grade = GRADES.iter().find(|g| g.eq_ignore_ascii_case(&self.grade)).copied().unwrap_or("Off");
        let key: String = self.compare_key.chars().filter(|c| c.is_ascii_alphanumeric()).take(20).collect();
        let key = if key.is_empty() { "F9".to_string() } else { key };
        format!(
            "; Written by the ModHeim launcher. Change it in ModHeim > Graphics.\n\
             Enabled = {}\nPreset = {}\nReflections = {}\nReflectionProbe = {}\nProbeResolution = {}\n\
             FullTextures = {}\nAnisotropic = {}\nLodBias = {:.2}\nShadowDistance = {:.0}\nShadowQuality = {}\n\
             AmbientOcclusion = {}\nAntiAliasing = {}\nSharpen = {:.2}\nTonemapping = {}\nExposure = {:.2}\n\
             Contrast = {:.2}\nSaturation = {:.2}\nTemperature = {:.1}\nBloom = {:.2}\nVignette = {:.2}\n\
             AutoExposure = {}\nGrassDistance = {:.0}\nGrade = {}\nGradeStrength = {:.2}\nClarity = {:.2}\n\
             GodRays = {}\nDeband = {}\nFilmGrain = {:.2}\nCompareKey = {}\n",
            self.enabled,
            self.preset.replace(['\n', '\r', '='], " "),
            self.reflections.min(3),
            self.reflection_probe,
            self.probe_resolution.clamp(64, 1024).next_power_of_two().min(1024),
            self.full_textures,
            [0u8, 2, 4, 8, 16].into_iter().find(|&a| a >= self.anisotropic.min(16)).unwrap_or(16),
            self.lod_bias.clamp(0.0, 6.0),
            self.shadow_distance.clamp(0.0, 600.0),
            self.shadow_quality.min(2),
            self.ambient_occlusion.min(2),
            self.anti_aliasing.min(1),
            self.sharpen.clamp(0.0, 1.5),
            tonemap,
            self.exposure.clamp(-2.0, 2.0),
            self.contrast.clamp(0.5, 1.6),
            self.saturation.clamp(0.0, 2.0),
            self.temperature.clamp(-50.0, 50.0),
            self.bloom.clamp(0.0, 3.0),
            self.vignette.clamp(-1.0, 0.6),
            self.auto_exposure,
            self.grass_distance.clamp(0.0, 300.0),
            grade,
            self.grade_strength.clamp(0.0, 1.0),
            self.clarity.clamp(0.0, 1.0),
            self.god_rays.min(2),
            self.deband,
            self.film_grain.clamp(0.0, 0.6),
            key,
        )
    }

    pub fn parse(text: &str) -> Graphics {
        let mut g = Graphics::default();
        for line in text.lines() {
            let line = line.trim();
            if line.starts_with(';') || line.starts_with('#') {
                continue;
            }
            let Some((k, v)) = line.split_once('=') else { continue };
            let (k, v) = (k.trim().to_ascii_lowercase(), v.trim());
            let b = || v.eq_ignore_ascii_case("true") || v == "1";
            let f = || v.parse::<f32>().unwrap_or(0.0);
            let n = || v.parse::<u32>().unwrap_or(0);
            match k.as_str() {
                "enabled" => g.enabled = b(),
                "preset" => g.preset = v.to_string(),
                "reflections" => g.reflections = n().min(3) as u8,
                "reflectionprobe" => g.reflection_probe = b(),
                "proberesolution" => g.probe_resolution = n().clamp(64, 1024),
                "fulltextures" => g.full_textures = b(),
                "anisotropic" => g.anisotropic = n().min(16) as u8,
                "lodbias" => g.lod_bias = f(),
                "shadowdistance" => g.shadow_distance = f(),
                "shadowquality" => g.shadow_quality = n().min(2) as u8,
                "ambientocclusion" => g.ambient_occlusion = n().min(2) as u8,
                "antialiasing" => g.anti_aliasing = n().min(1) as u8,
                "sharpen" => g.sharpen = f(),
                "tonemapping" => g.tonemapping = v.to_string(),
                "exposure" => g.exposure = f(),
                "contrast" => g.contrast = f(),
                "saturation" => g.saturation = f(),
                "temperature" => g.temperature = f(),
                "bloom" => g.bloom = f(),
                "vignette" => g.vignette = f(),
                "autoexposure" => g.auto_exposure = b(),
                "grassdistance" => g.grass_distance = f(),
                "grade" => g.grade = v.to_string(),
                "gradestrength" => g.grade_strength = f(),
                "clarity" => g.clarity = f(),
                "godrays" => g.god_rays = n().min(2) as u8,
                "deband" => g.deband = b(),
                "filmgrain" => g.film_grain = f(),
                "comparekey" => g.compare_key = v.to_string(),
                _ => {}
            }
        }
        g
    }
}

fn path(profile: &str, rel: &str) -> std::path::PathBuf {
    rel.split('/').fold(profiles::dir(profile), |p, c| p.join(c))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphicsState {
    pub installed: bool,
    pub plugin_enabled: bool,
    pub settings: Option<Graphics>,
    /// The plugin's last report from the game log (rendering path, what's on).
    pub last_report: Option<String>,
}

pub fn state(profile: &str) -> Result<GraphicsState> {
    let p = profiles::load(profile)?;
    let m = p.find(PLUGIN_ID);
    let last_report = std::fs::read(path(profile, "BepInEx/LogOutput.log")).ok().and_then(|b| {
        String::from_utf8_lossy(&b)
            .lines()
            .rev()
            .find(|l| l.contains("ModHeim Graphics") && l.contains("rendering"))
            .and_then(|l| l.split_once(']').map(|(_, r)| r.trim().to_string()))
    });
    Ok(GraphicsState {
        installed: m.is_some(),
        plugin_enabled: m.map(|m| m.enabled).unwrap_or(false),
        settings: std::fs::read_to_string(path(profile, SETTINGS_REL)).ok().map(|t| Graphics::parse(&t)),
        last_report,
    })
}

/// Put the plugin into the profile (or refresh it) and record it like any other mod.
pub fn ensure_plugin(profile: &mut Profile, game_running: bool) -> Result<()> {
    let dll = path(&profile.name, PLUGIN_REL);
    let up_to_date = std::fs::read(&dll).map(|b| b == PLUGIN_DLL).unwrap_or(false);
    if !up_to_date && !(game_running && dll.exists()) {
        std::fs::create_dir_all(dll.parent().unwrap())?;
        std::fs::write(&dll, PLUGIN_DLL)?;
        let _ = std::fs::remove_file(dll.with_extension("dll.old"));
    }
    let enabled = profile.find(PLUGIN_ID).map(|m| m.enabled).unwrap_or(true);
    profile.upsert(InstalledMod {
        full_name: PLUGIN_ID.into(),
        owner: "ModHeim".into(),
        name: "Graphics".into(),
        version: PLUGIN_VERSION.into(),
        enabled,
        icon: String::new(),
        description: "ModHeim's graphics upgrade: reflections, full-resolution textures, shadows, film grading, god rays and TAA. Visual only."
            .into(),
        dependencies: vec![],
        files: vec![PLUGIN_REL.into()],
        installed_at: chrono::Utc::now().to_rfc3339(),
    });
    if !enabled {
        crate::mods::set_enabled(&profiles::dir(&profile.name), &[PLUGIN_REL.into()], true)?;
        if let Some(m) = profile.find_mut(PLUGIN_ID) {
            m.enabled = true;
        }
    }
    profiles::save(profile)
}

pub fn write_settings(profile: &str, g: &Graphics) -> Result<()> {
    let dest = path(profile, SETTINGS_REL);
    std::fs::create_dir_all(dest.parent().unwrap())?;
    // write then rename so the plugin's file watcher never sees half a file
    let tmp = dest.with_extension("preset.tmp");
    std::fs::write(&tmp, g.to_file())?;
    std::fs::rename(&tmp, &dest)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_file_roundtrip_and_clamping() {
        let g = Graphics {
            enabled: true,
            preset: "Ultra\nEnabled = false".into(),
            reflections: 9,
            reflection_probe: true,
            probe_resolution: 300,
            full_textures: true,
            anisotropic: 5,
            lod_bias: 9.0,
            shadow_distance: 250.0,
            shadow_quality: 2,
            ambient_occlusion: 2,
            anti_aliasing: 1,
            sharpen: 0.4,
            tonemapping: "ACES".into(),
            exposure: 0.2,
            contrast: 1.1,
            saturation: 1.05,
            temperature: 4.0,
            bloom: 1.2,
            vignette: 0.25,
            auto_exposure: true,
            grass_distance: 120.0,
            grade: "cinematic".into(),
            grade_strength: 3.0,
            clarity: 0.4,
            god_rays: 7,
            deband: true,
            film_grain: 0.15,
            compare_key: "F9; Enabled = false".into(),
        };
        let file = g.to_file();
        assert!(file.contains("Preset = Ultra Enabled   false\n"));
        assert!(file.contains("Reflections = 3\n"));
        assert!(file.contains("ProbeResolution = 512\n"));
        assert!(file.contains("Anisotropic = 8\n"));
        assert!(file.contains("LodBias = 6.00\n"));
        assert!(file.contains("Grade = Cinematic\n"));
        assert!(file.contains("GradeStrength = 1.00\n"));
        assert!(file.contains("GodRays = 2\n"));
        assert!(file.contains("CompareKey = F9Enabledfalse\n"));
        assert_eq!(file.matches("Enabled = ").count(), 1);
        let back = Graphics::parse(&file);
        assert!(back.enabled && back.full_textures && back.auto_exposure);
        assert_eq!(back.reflections, 3);
        assert_eq!(back.tonemapping, "ACES");
        assert_eq!(back.shadow_distance, 250.0);
        assert_eq!(back.vignette, 0.25);
        assert!(back.deband);
        assert_eq!(back.film_grain, 0.15);
        assert_eq!(Graphics::parse("Tonemapping = Weird").to_file().contains("Tonemapping = Game"), true);
    }

    #[test]
    fn plugin_is_embedded() {
        assert_eq!(&PLUGIN_DLL[..2], b"MZ");
    }

    /// Checks the bundled plugin against this PC's game DLLs:
    /// cargo test plugin_matches_installed_game -- --ignored --nocapture
    #[test]
    #[ignore]
    fn plugin_matches_installed_game() {
        let game = std::path::Path::new(r"C:\XboxGames\Valheim\Content");
        let tmp = tempfile::tempdir().unwrap();
        let dll = tmp.path().join("ModHeim.Graphics.dll");
        std::fs::write(&dll, PLUGIN_DLL).unwrap();
        let missing = crate::compat::missing_in_game(&dll, game);
        println!("plugin uses {} game members; missing: {:?}", missing.0, missing.1);
        assert!(missing.0 > 20, "expected the plugin to use the game's post-processing types");
        assert!(missing.1.is_empty());
        // fields the plugin reaches by name
        for (asm, ty, fields) in [
            (
                "assembly_sunshafts.dll",
                "UnityStandardAssets.ImageEffects.SunShafts",
                &["sunShaftIntensity", "resolution", "radialBlurIterations", "sunShaftBlurRadius"][..],
            ),
            (
                "assembly_sunshafts.dll",
                "UnityStandardAssets.ImageEffects.ContrastEnhance",
                &["intensity", "threshold", "blurSpread", "separableBlurShader", "contrastCompositeShader"][..],
            ),
            (
                "assembly_valheim.dll",
                "AmplifyOcclusionEffect",
                &["SampleCount", "Intensity", "PowerExponent", "BlurEnabled", "BlurPasses", "FilterEnabled"][..],
            ),
            ("assembly_valheim.dll", "ClutterSystem", &["m_instance", "m_distance"][..]),
        ] {
            let have = crate::compat::game_type_fields(game, asm, ty).unwrap_or_else(|| panic!("{ty} not in {asm}"));
            for f in fields {
                assert!(have.contains(*f), "{ty}.{f} missing");
            }
        }
    }
}
