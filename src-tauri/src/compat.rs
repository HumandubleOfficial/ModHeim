//! Version compatibility: which game types and members each mod DLL uses, checked against the
//! installed game's own DLLs. A mod built for an older Valheim that touches something the
//! current version removed crashes with MissingFieldException / MissingMethodException /
//! TypeLoadException, sometimes every frame (the "game not responding" kind of break).
//!
//! This reads the .NET metadata tables directly (ECMA-335 II.22-24): TypeRef / MemberRef in the
//! mod, TypeDef / Field / MethodDef in the game. Nothing is loaded or run.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use serde::Serialize;

use crate::profiles::Profile;
use crate::thunderstore::BEPINEX_PACK;

// ------------------------------------------------------------ metadata reader

struct Reader<'a> {
    b: &'a [u8],
}

impl<'a> Reader<'a> {
    fn u8(&self, at: usize) -> Option<u8> {
        self.b.get(at).copied()
    }
    fn u16(&self, at: usize) -> Option<u16> {
        Some(u16::from_le_bytes(self.b.get(at..at + 2)?.try_into().ok()?))
    }
    fn u32(&self, at: usize) -> Option<u32> {
        Some(u32::from_le_bytes(self.b.get(at..at + 4)?.try_into().ok()?))
    }
    fn u64(&self, at: usize) -> Option<u64> {
        Some(u64::from_le_bytes(self.b.get(at..at + 8)?.try_into().ok()?))
    }
}

#[derive(Clone, Copy)]
enum Col {
    U16,
    U32,
    Str,
    Guid,
    Blob,
    Idx(usize),
    Coded(Coded),
}

#[derive(Clone, Copy)]
enum Coded {
    TypeDefOrRef,
    HasConstant,
    HasCustomAttribute,
    HasFieldMarshal,
    HasDeclSecurity,
    MemberRefParent,
    HasSemantics,
    MethodDefOrRef,
    MemberForwarded,
    Implementation,
    CustomAttributeType,
    ResolutionScope,
    TypeOrMethodDef,
}

impl Coded {
    fn spec(self) -> (u32, &'static [usize]) {
        // (tag bits, tables that can be referenced); 0xFF = unused slot
        match self {
            Coded::TypeDefOrRef => (2, &[0x02, 0x01, 0x1B]),
            Coded::HasConstant => (2, &[0x04, 0x08, 0x17]),
            Coded::HasCustomAttribute => (
                5,
                &[0x06, 0x04, 0x01, 0x02, 0x08, 0x09, 0x0A, 0x00, 0x0E, 0x17, 0x14, 0x11, 0x1A, 0x1B, 0x20, 0x23, 0x26, 0x27, 0x28, 0x2A, 0x2C, 0x2B],
            ),
            Coded::HasFieldMarshal => (1, &[0x04, 0x08]),
            Coded::HasDeclSecurity => (2, &[0x02, 0x06, 0x20]),
            Coded::MemberRefParent => (3, &[0x02, 0x01, 0x1A, 0x06, 0x1B]),
            Coded::HasSemantics => (1, &[0x14, 0x17]),
            Coded::MethodDefOrRef => (1, &[0x06, 0x0A]),
            Coded::MemberForwarded => (1, &[0x04, 0x06]),
            Coded::Implementation => (2, &[0x26, 0x23, 0x27]),
            Coded::CustomAttributeType => (3, &[0xFF, 0xFF, 0x06, 0x0A, 0xFF]),
            Coded::ResolutionScope => (2, &[0x00, 0x1A, 0x23, 0x01]),
            Coded::TypeOrMethodDef => (1, &[0x02, 0x06]),
        }
    }
}

fn schema(table: usize) -> &'static [Col] {
    use Col::*;
    use crate::compat::Coded::*;
    match table {
        0x00 => &[U16, Str, Guid, Guid, Guid],
        0x01 => &[Coded(ResolutionScope), Str, Str],
        0x02 => &[U32, Str, Str, Coded(TypeDefOrRef), Idx(0x04), Idx(0x06)],
        0x03 => &[Idx(0x04)],
        0x04 => &[U16, Str, Blob],
        0x05 => &[Idx(0x06)],
        0x06 => &[U32, U16, U16, Str, Blob, Idx(0x08)],
        0x07 => &[Idx(0x08)],
        0x08 => &[U16, U16, Str],
        0x09 => &[Idx(0x02), Coded(TypeDefOrRef)],
        0x0A => &[Coded(MemberRefParent), Str, Blob],
        0x0B => &[U16, Coded(HasConstant), Blob],
        0x0C => &[Coded(HasCustomAttribute), Coded(CustomAttributeType), Blob],
        0x0D => &[Coded(HasFieldMarshal), Blob],
        0x0E => &[U16, Coded(HasDeclSecurity), Blob],
        0x0F => &[U16, U32, Idx(0x02)],
        0x10 => &[U32, Idx(0x04)],
        0x11 => &[Blob],
        0x12 => &[Idx(0x02), Idx(0x14)],
        0x13 => &[Idx(0x14)],
        0x14 => &[U16, Str, Coded(TypeDefOrRef)],
        0x15 => &[Idx(0x02), Idx(0x17)],
        0x16 => &[Idx(0x17)],
        0x17 => &[U16, Str, Blob],
        0x18 => &[U16, Idx(0x06), Coded(HasSemantics)],
        0x19 => &[Idx(0x02), Coded(MethodDefOrRef), Coded(MethodDefOrRef)],
        0x1A => &[Str],
        0x1B => &[Blob],
        0x1C => &[U16, Coded(MemberForwarded), Str, Idx(0x1A)],
        0x1D => &[U32, Idx(0x04)],
        0x1E => &[U32, U32],
        0x1F => &[U32],
        0x20 => &[U32, U16, U16, U16, U16, U32, Blob, Str, Str],
        0x21 => &[U32],
        0x22 => &[U32, U32, U32],
        0x23 => &[U16, U16, U16, U16, U32, Blob, Str, Str, Blob],
        0x24 => &[U32, Idx(0x23)],
        0x25 => &[U32, U32, U32, Idx(0x23)],
        0x26 => &[U32, Str, Blob],
        0x27 => &[U32, U32, Str, Str, Coded(Implementation)],
        0x28 => &[U32, U32, Str, Coded(Implementation)],
        0x29 => &[Idx(0x02), Idx(0x02)],
        0x2A => &[U16, U16, Coded(TypeOrMethodDef), Str],
        0x2B => &[Coded(MethodDefOrRef), Blob],
        0x2C => &[Idx(0x2A), Coded(TypeDefOrRef)],
        _ => &[],
    }
}

struct Metadata<'a> {
    r: Reader<'a>,
    strings: usize,
    blob: usize,
    rows: [u32; 64],
    table_at: [usize; 64],
    row_size: [usize; 64],
    col_sizes: Vec<Vec<usize>>,
    str_wide: bool,
    guid_wide: bool,
    blob_wide: bool,
}

impl<'a> Metadata<'a> {
    fn parse(b: &'a [u8]) -> Option<Metadata<'a>> {
        let r = Reader { b };
        if r.u16(0)? != 0x5A4D {
            return None;
        }
        let pe = r.u32(0x3C)? as usize;
        if r.u32(pe)? != 0x0000_4550 {
            return None;
        }
        let coff = pe + 4;
        let sections = r.u16(coff + 2)? as usize;
        let opt_size = r.u16(coff + 16)? as usize;
        let opt = coff + 20;
        let dirs = match r.u16(opt)? {
            0x10B => opt + 96,
            0x20B => opt + 112,
            _ => return None,
        };
        let cli_rva = r.u32(dirs + 14 * 8)? as usize;
        let sec_table = opt + opt_size;
        let rva = |v: usize| -> Option<usize> {
            for i in 0..sections {
                let s = sec_table + i * 40;
                let va = r.u32(s + 12)? as usize;
                let vsize = (r.u32(s + 8)? as usize).max(r.u32(s + 16)? as usize);
                let raw = r.u32(s + 20)? as usize;
                if v >= va && v < va + vsize {
                    return Some(v - va + raw);
                }
            }
            None
        };
        let cli = rva(cli_rva)?;
        let md = rva(r.u32(cli + 8)? as usize)?;
        if r.u32(md)? != 0x424A_5342 {
            return None;
        }
        let ver_len = r.u32(md + 12)? as usize;
        let mut p = md + 16 + ver_len;
        let streams = r.u16(p + 2)? as usize;
        p += 4;
        let (mut tables, mut strings, mut blob) = (None, None, None);
        for _ in 0..streams {
            let off = r.u32(p)? as usize;
            let name_start = p + 8;
            let name_end = name_start + b.get(name_start..)?.iter().position(|&c| c == 0)?;
            let name = std::str::from_utf8(&b[name_start..name_end]).ok()?;
            match name {
                "#~" | "#-" => tables = Some(md + off),
                "#Strings" => strings = Some(md + off),
                "#Blob" => blob = Some(md + off),
                _ => {}
            }
            p = name_start + ((name_end - name_start + 1 + 3) & !3);
        }
        let t = tables?;
        let heaps = r.u8(t + 6)?;
        let valid = r.u64(t + 8)?;
        let mut rows = [0u32; 64];
        let mut q = t + 24;
        for (i, row) in rows.iter_mut().enumerate() {
            if valid & (1 << i) != 0 {
                *row = r.u32(q)?;
                q += 4;
            }
        }
        if heaps & 0x40 != 0 {
            q += 4; // extra data
        }
        let mut m = Metadata {
            r,
            strings: strings?,
            blob: blob?,
            rows,
            table_at: [0; 64],
            row_size: [0; 64],
            col_sizes: vec![Vec::new(); 64],
            str_wide: heaps & 0x01 != 0,
            guid_wide: heaps & 0x02 != 0,
            blob_wide: heaps & 0x04 != 0,
        };
        for i in 0..64 {
            if rows[i] == 0 {
                continue;
            }
            let cols: Vec<usize> = schema(i).iter().map(|c| m.col_size(*c)).collect();
            if cols.is_empty() {
                return None; // a table this reader doesn't know: bail rather than misread
            }
            m.table_at[i] = q;
            m.row_size[i] = cols.iter().sum();
            q += m.row_size[i] * rows[i] as usize;
            m.col_sizes[i] = cols;
        }
        if q > b.len() {
            return None;
        }
        Some(m)
    }

    fn col_size(&self, c: Col) -> usize {
        match c {
            Col::U16 => 2,
            Col::U32 => 4,
            Col::Str => if self.str_wide { 4 } else { 2 },
            Col::Guid => if self.guid_wide { 4 } else { 2 },
            Col::Blob => if self.blob_wide { 4 } else { 2 },
            Col::Idx(t) => if self.rows[t] > 0xFFFF { 4 } else { 2 },
            Col::Coded(k) => {
                let (bits, tables) = k.spec();
                let max = tables.iter().filter(|&&t| t != 0xFF).map(|&t| self.rows[t]).max().unwrap_or(0);
                if max < (1 << (16 - bits)) { 2 } else { 4 }
            }
        }
    }

    /// Column `col` of 1-based `row` in `table`, as a number.
    fn get(&self, table: usize, row: u32, col: usize) -> u32 {
        if row == 0 || row > self.rows[table] {
            return 0;
        }
        let mut at = self.table_at[table] + self.row_size[table] * (row as usize - 1);
        for s in &self.col_sizes[table][..col] {
            at += s;
        }
        match self.col_sizes[table][col] {
            2 => self.r.u16(at).unwrap_or(0) as u32,
            _ => self.r.u32(at).unwrap_or(0),
        }
    }

    fn string(&self, idx: u32) -> String {
        let start = self.strings + idx as usize;
        let Some(rest) = self.r.b.get(start..) else { return String::new() };
        let end = rest.iter().position(|&c| c == 0).unwrap_or(0);
        String::from_utf8_lossy(&rest[..end]).into_owned()
    }

    fn blob_first(&self, idx: u32) -> Option<u8> {
        let at = self.blob + idx as usize;
        let b0 = self.r.u8(at)?;
        let skip = if b0 & 0x80 == 0 { 1 } else if b0 & 0xC0 == 0x80 { 2 } else { 4 };
        self.r.u8(at + skip)
    }

    fn decode(&self, k: Coded, v: u32) -> (usize, u32) {
        let (bits, tables) = k.spec();
        let tag = (v & ((1 << bits) - 1)) as usize;
        (tables.get(tag).copied().unwrap_or(0xFF), v >> bits)
    }
}

// ------------------------------------------------------------ Harmony patches a mod declares

/// What kind of Harmony patch a method is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PatchKind {
    Prefix,
    Postfix,
    Transpiler,
    Finalizer,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Patch {
    /// "Player.Update", "Player.get_Stamina", "Ship..ctor"
    pub target: String,
    pub kind: PatchKind,
    /// A prefix returning bool: it can skip the game's own method.
    pub can_skip: bool,
}

/// Compressed unsigned integer (II.23.2).
fn cu(b: &[u8], p: &mut usize) -> Option<u32> {
    let b0 = *b.get(*p)? as u32;
    if b0 & 0x80 == 0 {
        *p += 1;
        Some(b0)
    } else if b0 & 0xC0 == 0x80 {
        let v = ((b0 & 0x3F) << 8) | *b.get(*p + 1)? as u32;
        *p += 2;
        Some(v)
    } else {
        let v = ((b0 & 0x1F) << 24) | (*b.get(*p + 1)? as u32) << 16 | (*b.get(*p + 2)? as u32) << 8 | *b.get(*p + 3)? as u32;
        *p += 4;
        Some(v)
    }
}

#[derive(Clone, Copy, PartialEq)]
enum Param {
    Str,
    Type,
    I4,
    Bool,
    Arr(ArrElem),
}
#[derive(Clone, Copy, PartialEq)]
enum ArrElem {
    Str,
    Type,
    I4,
}

#[derive(Debug, Clone, PartialEq)]
enum Arg {
    Str(Option<String>),
    Type(Option<String>),
    I4(i32),
    Other,
}

impl<'a> Metadata<'a> {
    fn blob(&self, idx: u32) -> Option<&'a [u8]> {
        let mut p = self.blob + idx as usize;
        let len = cu(self.r.b, &mut p)? as usize;
        self.r.b.get(p..p + len)
    }

    fn type_ref_name(&self, table: usize, row: u32) -> String {
        let (t, name_col, ns_col) = match table {
            0x01 => (0x01, 1, 2),
            0x02 => (0x02, 1, 2),
            _ => return String::new(),
        };
        let name = self.string(self.get(t, row, name_col));
        let ns = self.string(self.get(t, row, ns_col));
        if ns.is_empty() { name } else { format!("{ns}.{name}") }
    }

    /// Parameter types of an attribute constructor's signature.
    fn ctor_params(&self, sig: &[u8]) -> Option<Vec<Param>> {
        let mut p = 1; // calling convention
        let n = cu(sig, &mut p)?;
        p += 1; // return type: void
        let mut out = Vec::new();
        for _ in 0..n {
            out.push(self.sig_param(sig, &mut p)?);
        }
        Some(out)
    }

    fn sig_param(&self, sig: &[u8], p: &mut usize) -> Option<Param> {
        let et = *sig.get(*p)?;
        *p += 1;
        Some(match et {
            0x0E => Param::Str,
            0x08 => Param::I4,
            0x02 => Param::Bool,
            // a class in an attribute constructor is System.Type
            0x12 => {
                cu(sig, p)?;
                Param::Type
            }
            // value type: an enum (MethodType / ArgumentType), int-sized
            0x11 => {
                cu(sig, p)?;
                Param::I4
            }
            0x1D => match self.sig_param(sig, p)? {
                Param::Str => Param::Arr(ArrElem::Str),
                Param::Type => Param::Arr(ArrElem::Type),
                Param::I4 => Param::Arr(ArrElem::I4),
                _ => return None,
            },
            _ => return None,
        })
    }
}

fn ser_string(b: &[u8], p: &mut usize) -> Option<Option<String>> {
    if *b.get(*p)? == 0xFF {
        *p += 1;
        return Some(None);
    }
    let len = cu(b, p)? as usize;
    let s = String::from_utf8_lossy(b.get(*p..*p + len)?).into_owned();
    *p += len;
    Some(Some(s))
}

/// Decode a custom attribute's fixed arguments (II.23.3).
fn attr_args(params: &[Param], value: &[u8]) -> Option<Vec<Arg>> {
    if value.get(0..2)? != [1, 0] {
        return None;
    }
    let mut p = 2;
    let mut out = Vec::new();
    for prm in params {
        match prm {
            Param::Str => out.push(Arg::Str(ser_string(value, &mut p)?)),
            Param::Type => out.push(Arg::Type(ser_string(value, &mut p)?)),
            Param::I4 => {
                out.push(Arg::I4(i32::from_le_bytes(value.get(p..p + 4)?.try_into().ok()?)));
                p += 4;
            }
            Param::Bool => {
                p += 1;
                out.push(Arg::Other);
            }
            Param::Arr(e) => {
                let n = u32::from_le_bytes(value.get(p..p + 4)?.try_into().ok()?);
                p += 4;
                if n != u32::MAX {
                    for _ in 0..n {
                        match e {
                            ArrElem::Str | ArrElem::Type => {
                                ser_string(value, &mut p)?;
                            }
                            ArrElem::I4 => p += 4,
                        }
                    }
                }
                out.push(Arg::Other);
            }
        }
    }
    Some(out)
}

/// The patch target a [HarmonyPatch(...)] gives, merged class-level then method-level.
#[derive(Default, Clone)]
struct Target {
    ty: Option<String>,
    method: Option<String>,
    method_type: Option<i32>,
}

impl Target {
    fn from_args(args: &[Arg]) -> Target {
        let mut t = Target::default();
        let types: Vec<&String> = args.iter().filter_map(|a| if let Arg::Type(Some(s)) = a { Some(s) } else { None }).collect();
        let strs: Vec<&String> = args.iter().filter_map(|a| if let Arg::Str(Some(s)) = a { Some(s) } else { None }).collect();
        if let Some(ty) = types.first() {
            // "Player, assembly_valheim, Version=..." -> "Player"; nested "Outer+Inner"
            t.ty = Some(ty.split(',').next().unwrap_or(ty).trim().replace('+', "."));
            t.method = strs.first().map(|s| s.to_string());
        } else if strs.len() >= 2 {
            t.ty = Some(strs[0].clone());
            t.method = Some(strs[1].clone());
        } else {
            t.method = strs.first().map(|s| s.to_string());
        }
        t.method_type = args.iter().find_map(|a| if let Arg::I4(v) = a { Some(*v) } else { None });
        t
    }

    fn merge(&mut self, o: &Target) {
        if o.ty.is_some() {
            self.ty = o.ty.clone();
        }
        if o.method.is_some() {
            self.method = o.method.clone();
        }
        if o.method_type.is_some() {
            self.method_type = o.method_type;
        }
    }

    fn name(&self) -> Option<String> {
        let ty = self.ty.as_deref()?;
        // keep only the short type name; namespaces are noise for Valheim's types
        let short = ty.rsplit('.').next().unwrap_or(ty);
        let m = match (self.method_type.unwrap_or(0), self.method.as_deref()) {
            (1, Some(m)) => format!("get_{m}"),
            (2, Some(m)) => format!("set_{m}"),
            (3, _) => ".ctor".to_string(),
            (4, _) => ".cctor".to_string(),
            (_, Some(m)) => m.to_string(),
            _ => return None,
        };
        Some(format!("{short}.{m}"))
    }
}

/// Every Harmony patch declared with attributes in a DLL. Patches set up in code
/// (harmony.Patch(...)) can't be seen this way and are left out.
fn patches_of(b: &[u8]) -> Option<Vec<Patch>> {
    let m = Metadata::parse(b)?;
    // attribute constructors that belong to Harmony: MemberRef row -> (attribute name, params)
    let mut harmony_ctors: HashMap<u32, (String, Vec<Param>)> = HashMap::new();
    for i in 1..=m.rows[0x0A] {
        let (table, row) = m.decode(Coded::MemberRefParent, m.get(0x0A, i, 0));
        if table != 0x01 || m.string(m.get(0x0A, i, 1)) != ".ctor" {
            continue;
        }
        let full = m.type_ref_name(0x01, row);
        let Some(name) = full.strip_prefix("HarmonyLib.").or_else(|| full.strip_prefix("Harmony.")) else { continue };
        if !matches!(name, "HarmonyPatch" | "HarmonyPrefix" | "HarmonyPostfix" | "HarmonyTranspiler" | "HarmonyFinalizer") {
            continue;
        }
        let Some(params) = m.blob(m.get(0x0A, i, 2)).and_then(|sig| m.ctor_params(sig)) else { continue };
        harmony_ctors.insert(i, (name.to_string(), params));
    }
    if harmony_ctors.is_empty() {
        return Some(Vec::new());
    }
    // (table, row) of the thing an attribute sits on -> its Harmony attributes
    let mut attrs: HashMap<(usize, u32), Vec<(String, Vec<Arg>)>> = HashMap::new();
    for i in 1..=m.rows[0x0C] {
        let (ctor_table, ctor_row) = m.decode(Coded::CustomAttributeType, m.get(0x0C, i, 1));
        if ctor_table != 0x0A {
            continue;
        }
        let Some((name, params)) = harmony_ctors.get(&ctor_row) else { continue };
        let parent = m.decode(Coded::HasCustomAttribute, m.get(0x0C, i, 0));
        let args = m.blob(m.get(0x0C, i, 2)).and_then(|v| attr_args(params, v)).unwrap_or_default();
        attrs.entry(parent).or_default().push((name.clone(), args));
    }
    let target_of = |list: Option<&Vec<(String, Vec<Arg>)>>| -> (Option<Target>, Option<PatchKind>) {
        let mut t: Option<Target> = None;
        let mut kind = None;
        for (name, args) in list.into_iter().flatten() {
            match name.as_str() {
                "HarmonyPatch" => t.get_or_insert_with(Target::default).merge(&Target::from_args(args)),
                "HarmonyPrefix" => kind = Some(PatchKind::Prefix),
                "HarmonyPostfix" => kind = Some(PatchKind::Postfix),
                "HarmonyTranspiler" => kind = Some(PatchKind::Transpiler),
                "HarmonyFinalizer" => kind = Some(PatchKind::Finalizer),
                _ => {}
            }
        }
        (t, kind)
    };
    let n = m.rows[0x02];
    let mut out: HashSet<Patch> = HashSet::new();
    for ty in 1..=n {
        let (class_target, _) = target_of(attrs.get(&(0x02, ty)));
        let from = m.get(0x02, ty, 5);
        let to = if ty < n { m.get(0x02, ty + 1, 5) } else { m.rows[0x06] + 1 };
        for md in from..to.max(from) {
            let (method_target, marked) = target_of(attrs.get(&(0x06, md)));
            if class_target.is_none() && method_target.is_none() {
                continue;
            }
            let name = m.string(m.get(0x06, md, 3));
            let kind = marked.or(match name.as_str() {
                "Prefix" => Some(PatchKind::Prefix),
                "Postfix" => Some(PatchKind::Postfix),
                "Transpiler" => Some(PatchKind::Transpiler),
                "Finalizer" => Some(PatchKind::Finalizer),
                _ => None,
            });
            let Some(kind) = kind else { continue };
            let mut t = class_target.clone().unwrap_or_default();
            if let Some(mt) = &method_target {
                t.merge(mt);
            }
            let Some(target) = t.name() else { continue };
            let can_skip = kind == PatchKind::Prefix && returns_bool(m.blob(m.get(0x06, md, 4)).unwrap_or_default());
            out.insert(Patch { target, kind, can_skip });
        }
    }
    let mut v: Vec<Patch> = out.into_iter().collect();
    v.sort_by(|a, b| a.target.cmp(&b.target));
    Some(v)
}

/// Does a MethodDef signature return bool?
fn returns_bool(sig: &[u8]) -> bool {
    let Some(&conv) = sig.first() else { return false };
    let mut p = 1;
    if conv & 0x10 != 0 && cu(sig, &mut p).is_none() {
        return false;
    }
    if cu(sig, &mut p).is_none() {
        return false;
    }
    // skip custom modifiers
    while matches!(sig.get(p), Some(0x1F) | Some(0x20)) {
        p += 1;
        if cu(sig, &mut p).is_none() {
            return false;
        }
    }
    sig.get(p) == Some(&0x02)
}

fn patch_cache() -> &'static Mutex<HashMap<PathBuf, (Stamp, Vec<Patch>)>> {
    static C: OnceLock<Mutex<HashMap<PathBuf, (Stamp, Vec<Patch>)>>> = OnceLock::new();
    C.get_or_init(Default::default)
}

/// Harmony patches in one DLL (cached by size and modification time).
pub fn dll_patches(path: &Path) -> Vec<Patch> {
    let Some(st) = stamp(path) else { return Vec::new() };
    if let Some((s, v)) = patch_cache().lock().unwrap().get(path) {
        if *s == st {
            return v.clone();
        }
    }
    let v = std::fs::read(path).ok().and_then(|b| patches_of(&b)).unwrap_or_default();
    patch_cache().lock().unwrap().insert(path.to_path_buf(), (st, v.clone()));
    v
}

// ------------------------------------------------------------ what a mod uses / what the game has

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct MemberUse {
    pub assembly: String,
    /// "Namespace.Type" or "Outer/Inner"
    pub type_name: String,
    /// None = the type itself
    pub member: Option<String>,
    pub field: bool,
}

/// Every game-type and game-member reference in a DLL. `is_game` picks which referenced
/// assemblies count as the game's (e.g. assembly_valheim).
fn uses_of(b: &[u8], is_game: &dyn Fn(&str) -> bool) -> Option<Vec<MemberUse>> {
    let m = Metadata::parse(b)?;
    let asm_names: Vec<String> = (1..=m.rows[0x23]).map(|i| m.string(m.get(0x23, i, 6))).collect();
    // TypeRef row -> (assembly, full name) when it resolves to a game assembly
    let mut type_refs: HashMap<u32, (String, String)> = HashMap::new();
    for i in 1..=m.rows[0x01] {
        let mut name = m.string(m.get(0x01, i, 1));
        let ns = m.string(m.get(0x01, i, 2));
        if !ns.is_empty() {
            name = format!("{ns}.{name}");
        }
        let mut scope = m.decode(Coded::ResolutionScope, m.get(0x01, i, 0));
        let mut depth = 0;
        // nested types point at their enclosing TypeRef
        while scope.0 == 0x01 && depth < 8 {
            let outer = scope.1;
            let mut o = m.string(m.get(0x01, outer, 1));
            let ons = m.string(m.get(0x01, outer, 2));
            if !ons.is_empty() {
                o = format!("{ons}.{o}");
            }
            name = format!("{o}/{name}");
            scope = m.decode(Coded::ResolutionScope, m.get(0x01, outer, 0));
            depth += 1;
        }
        if scope.0 == 0x23 {
            if let Some(asm) = asm_names.get(scope.1 as usize - 1).filter(|a| is_game(a)) {
                type_refs.insert(i, (asm.clone(), name));
            }
        }
    }
    let mut out: HashSet<MemberUse> = HashSet::new();
    for (asm, ty) in type_refs.values() {
        out.insert(MemberUse { assembly: asm.clone(), type_name: ty.clone(), member: None, field: false });
    }
    for i in 1..=m.rows[0x0A] {
        let (table, row) = m.decode(Coded::MemberRefParent, m.get(0x0A, i, 0));
        if table != 0x01 {
            continue;
        }
        let Some((asm, ty)) = type_refs.get(&row) else { continue };
        let field = m.blob_first(m.get(0x0A, i, 2)) == Some(0x06);
        out.insert(MemberUse { assembly: asm.clone(), type_name: ty.clone(), member: Some(m.string(m.get(0x0A, i, 1))), field });
    }
    Some(out.into_iter().collect())
}

#[derive(Default)]
struct TypeInfo {
    fields: HashSet<String>,
    methods: HashSet<String>,
    /// Base type inside the same game assembly, if any.
    base: Option<String>,
    /// Derives from something outside the game (e.g. MonoBehaviour), so inherited members can't be checked.
    external_base: bool,
}

#[derive(Default)]
pub struct GameIndex {
    /// assembly name (lowercase) -> type name -> members
    types: HashMap<String, HashMap<String, TypeInfo>>,
}

fn index_assembly(b: &[u8]) -> Option<(String, HashMap<String, TypeInfo>)> {
    let m = Metadata::parse(b)?;
    let asm_name = if m.rows[0x20] > 0 { m.string(m.get(0x20, 1, 7)) } else { return None };
    let n = m.rows[0x02];
    // nested -> enclosing
    let mut enclosing: HashMap<u32, u32> = HashMap::new();
    for i in 1..=m.rows[0x29] {
        enclosing.insert(m.get(0x29, i, 0), m.get(0x29, i, 1));
    }
    let simple = |row: u32| -> String {
        let name = m.string(m.get(0x02, row, 1));
        let ns = m.string(m.get(0x02, row, 2));
        if ns.is_empty() { name } else { format!("{ns}.{name}") }
    };
    let full = |row: u32| -> String {
        let mut name = simple(row);
        let mut cur = row;
        let mut depth = 0;
        while let Some(&outer) = enclosing.get(&cur) {
            name = format!("{}/{name}", simple(outer));
            cur = outer;
            depth += 1;
            if depth > 8 {
                break;
            }
        }
        name
    };
    let mut types = HashMap::new();
    for i in 1..=n {
        let fields_from = m.get(0x02, i, 4);
        let fields_to = if i < n { m.get(0x02, i + 1, 4) } else { m.rows[0x04] + 1 };
        let methods_from = m.get(0x02, i, 5);
        let methods_to = if i < n { m.get(0x02, i + 1, 5) } else { m.rows[0x06] + 1 };
        let mut t = TypeInfo::default();
        for f in fields_from..fields_to.max(fields_from) {
            t.fields.insert(m.string(m.get(0x04, f, 1)));
        }
        for f in methods_from..methods_to.max(methods_from) {
            t.methods.insert(m.string(m.get(0x06, f, 3)));
        }
        let (table, row) = m.decode(Coded::TypeDefOrRef, m.get(0x02, i, 3));
        match table {
            0x02 if row > 0 => t.base = Some(full(row)),
            0x01 | 0x1B if row > 0 => t.external_base = true,
            _ => {}
        }
        types.insert(full(i), t);
    }
    Some((asm_name, types))
}

impl GameIndex {
    /// Some(true) = exists, Some(false) = missing, None = can't tell (inherited from outside the game).
    fn has(&self, u: &MemberUse) -> Option<bool> {
        let types = self.types.get(&u.assembly.to_ascii_lowercase())?;
        let Some(member) = &u.member else { return Some(types.contains_key(&u.type_name)) };
        let mut cur = types.get(&u.type_name);
        if cur.is_none() {
            return Some(false); // the type itself is gone
        }
        for _ in 0..16 {
            let Some(t) = cur else { return None };
            let found = if u.field { t.fields.contains(member) } else { t.methods.contains(member) || t.fields.contains(member) };
            if found {
                return Some(true);
            }
            // C# compilers record a field under the class that declares it, so a field that
            // isn't on the game class is really gone. Methods can come from a Unity base class.
            if t.external_base {
                return if u.field { Some(false) } else { None };
            }
            match &t.base {
                Some(b) => cur = types.get(b),
                None => return Some(false),
            }
        }
        None
    }
}

fn is_game_assembly(name: &str) -> bool {
    name.to_ascii_lowercase().starts_with("assembly_")
}

// ------------------------------------------------------------ caches

type Stamp = (u64, u64); // size, mtime

fn stamp(p: &Path) -> Option<Stamp> {
    let md = std::fs::metadata(p).ok()?;
    let mtime = md.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?.as_secs();
    Some((md.len(), mtime))
}

struct GameCache {
    dir: PathBuf,
    stamps: Vec<Stamp>,
    index: std::sync::Arc<GameIndex>,
}

fn game_cache() -> &'static Mutex<Option<GameCache>> {
    static C: OnceLock<Mutex<Option<GameCache>>> = OnceLock::new();
    C.get_or_init(|| Mutex::new(None))
}

fn dll_cache() -> &'static Mutex<HashMap<PathBuf, (Stamp, Option<Vec<MemberUse>>)>> {
    static C: OnceLock<Mutex<HashMap<PathBuf, (Stamp, Option<Vec<MemberUse>>)>>> = OnceLock::new();
    C.get_or_init(|| Mutex::new(HashMap::new()))
}

/// The game's own assemblies (valheim_Data/Managed/assembly_*.dll), indexed once per game update.
pub fn game_index(game_dir: &Path) -> Option<std::sync::Arc<GameIndex>> {
    let managed = std::fs::read_dir(game_dir).ok()?.flatten().map(|e| e.path()).find_map(|p| {
        let m = p.join("Managed");
        (p.is_dir() && p.file_name()?.to_string_lossy().ends_with("_Data") && m.is_dir()).then_some(m)
    })?;
    let mut files: Vec<PathBuf> = std::fs::read_dir(&managed)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|e| e == "dll") && p.file_name().is_some_and(|n| is_game_assembly(&n.to_string_lossy())))
        .collect();
    files.sort();
    let stamps: Vec<Stamp> = files.iter().filter_map(|f| stamp(f)).collect();
    let mut cache = game_cache().lock().unwrap();
    if let Some(c) = cache.as_ref().filter(|c| c.dir == managed && c.stamps == stamps) {
        return Some(c.index.clone());
    }
    let mut index = GameIndex::default();
    for f in &files {
        if let Some((name, types)) = std::fs::read(f).ok().and_then(|b| index_assembly(&b)) {
            index.types.insert(name.to_ascii_lowercase(), types);
        }
    }
    if index.types.is_empty() {
        return None;
    }
    let index = std::sync::Arc::new(index);
    *cache = Some(GameCache { dir: managed, stamps, index: index.clone() });
    Some(index)
}

fn dll_uses(path: &Path) -> Option<Vec<MemberUse>> {
    let st = stamp(path)?;
    if let Some((s, uses)) = dll_cache().lock().unwrap().get(path) {
        if *s == st {
            return uses.clone();
        }
    }
    let uses = std::fs::read(path).ok().and_then(|b| uses_of(&b, &is_game_assembly));
    dll_cache().lock().unwrap().insert(path.to_path_buf(), (st, uses.clone()));
    uses
}

// ------------------------------------------------------------ results

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CompatIssue {
    pub full_name: String,
    pub name: String,
    /// What the mod uses that this game version doesn't have, e.g. "InstanceRenderer.m_frustumCull".
    pub missing: Vec<String>,
}

fn describe(u: &MemberUse) -> String {
    let ty = u.type_name.rsplit('.').next().unwrap_or(&u.type_name).replace('/', ".");
    match &u.member {
        Some(m) if u.field => format!("{ty}.{m}"),
        Some(m) if m == ".ctor" => format!("new {ty}()"),
        Some(m) => format!("{ty}.{m}()"),
        None => format!("type {ty}"),
    }
}

/// The field names of one type in one of the game's assemblies. For self-checks of plugins
/// that reach game fields by name.
#[cfg(test)]
pub fn game_type_fields(game_dir: &Path, asm: &str, type_name: &str) -> Option<HashSet<String>> {
    let b = std::fs::read(game_dir.join("Valheim_Data").join("Managed").join(asm)).ok()?;
    let (_, types) = index_assembly(&b)?;
    types.into_iter().find(|(n, _)| n == type_name).map(|(_, t)| t.fields)
}

/// (game members a DLL uses, the ones this game version doesn't have). For self-checks.
#[cfg(test)]
pub fn missing_in_game(dll: &Path, game_dir: &Path) -> (usize, Vec<String>) {
    let Some(game) = game_index(game_dir) else { return (0, vec!["game not found".into()]) };
    let uses = dll_uses(dll).unwrap_or_default();
    let missing = uses.iter().filter(|u| game.has(u) == Some(false)).map(describe).collect();
    (uses.len(), missing)
}

pub fn check_profile(profile: &Profile, profile_dir: &Path, game_dir: &Path) -> Vec<CompatIssue> {
    let Some(game) = game_index(game_dir) else { return Vec::new() };
    let mut out = Vec::new();
    for m in profile.mods.iter().filter(|m| m.enabled && m.full_name != BEPINEX_PACK) {
        let mut missing: Vec<String> = Vec::new();
        for f in m.files.iter().filter(|f| f.to_ascii_lowercase().ends_with(".dll")) {
            let path = f.split('/').fold(profile_dir.to_path_buf(), |p, c| p.join(c));
            for u in dll_uses(&path).unwrap_or_default() {
                if game.has(&u) == Some(false) {
                    let d = describe(&u);
                    if !missing.contains(&d) {
                        missing.push(d);
                    }
                }
            }
        }
        if !missing.is_empty() {
            missing.sort();
            out.push(CompatIssue { full_name: m.full_name.clone(), name: m.name.replace('_', " "), missing });
        }
    }
    out
}

/// For an error like "Field not found: bool .InstanceRenderer.m_frustumCull" or
/// "Could not load type ZSteamSocket", the enabled mods whose DLLs use that member or type.
pub fn mods_using(text: &str, profile: &Profile, profile_dir: &Path) -> Vec<(String, String)> {
    let (needle, is_type) = if let Some(rest) = text.split("Field not found: ").nth(1).or_else(|| text.split("Method not found: ").nth(1)) {
        // "bool .InstanceRenderer.m_frustumCull Due to..." / "void Foo.Bar(int)"
        let sig = rest.split(" Due to").next().unwrap_or(rest);
        let path = sig.split_whitespace().last().unwrap_or(sig);
        let path = path.split('(').next().unwrap_or(path).trim_start_matches('.');
        (path.to_string(), false)
    } else if let Some(rest) = text.split("Could not load type ").nth(1) {
        let ty = rest.split(|c: char| c == ',' || c.is_whitespace()).next().unwrap_or("");
        (ty.to_string(), true)
    } else {
        return Vec::new();
    };
    if needle.is_empty() {
        return Vec::new();
    }
    let mut out = Vec::new();
    for m in profile.mods.iter().filter(|m| m.enabled && m.full_name != BEPINEX_PACK) {
        let hit = m.files.iter().filter(|f| f.to_ascii_lowercase().ends_with(".dll")).any(|f| {
            let path = f.split('/').fold(profile_dir.to_path_buf(), |p, c| p.join(c));
            dll_uses(&path).unwrap_or_default().iter().any(|u| {
                let ty = u.type_name.replace('/', ".");
                if is_type {
                    u.member.is_none() && (ty == needle || ty.ends_with(&format!(".{needle}")))
                } else {
                    u.member.as_ref().is_some_and(|mm| {
                        let full = format!("{ty}.{mm}");
                        full == needle || full.ends_with(&format!(".{needle}"))
                    })
                }
            })
        });
        if hit {
            out.push((m.name.replace('_', " "), m.full_name.clone()));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const PLUGIN: &[u8] = include_bytes!("../resources/ModHeim.GameTheme.dll");

    #[test]
    fn reads_member_refs_from_a_real_plugin() {
        // Treat UnityEngine.UI as "the game" so the theme plugin has something to reference.
        let uses = uses_of(PLUGIN, &|a| a == "UnityEngine.UI").expect("parses");
        assert!(uses.iter().any(|u| u.type_name == "UnityEngine.UI.Graphic" && u.member.is_none()));
        assert!(uses.iter().any(|u| u.type_name.starts_with("UnityEngine.UI.") && u.member.is_some()));
        // everything else (BepInEx, Harmony, mscorlib) is filtered out
        assert!(uses.iter().all(|u| u.assembly == "UnityEngine.UI"));
    }

    #[test]
    fn indexes_its_own_types() {
        let (name, types) = index_assembly(PLUGIN).expect("indexes");
        assert_eq!(name, "ModHeim.GameTheme");
        assert!(types.values().any(|t| t.methods.contains(".ctor")));
    }

    #[test]
    fn reports_missing_members_and_types() {
        let mut ty = TypeInfo::default();
        ty.fields.insert("m_kept".into());
        ty.methods.insert("Update".into());
        let mut types = HashMap::new();
        types.insert("InstanceRenderer".to_string(), ty);
        let mut index = GameIndex::default();
        index.types.insert("assembly_valheim".into(), types);
        let u = |t: &str, m: Option<&str>, field| MemberUse { assembly: "assembly_valheim".into(), type_name: t.into(), member: m.map(Into::into), field };
        assert_eq!(index.has(&u("InstanceRenderer", Some("m_kept"), true)), Some(true));
        assert_eq!(index.has(&u("InstanceRenderer", Some("m_frustumCull"), true)), Some(false));
        assert_eq!(index.has(&u("InstanceRenderer", Some("Update"), false)), Some(true));
        assert_eq!(index.has(&u("ZSteamSocket", None, false)), Some(false));
        assert_eq!(describe(&u("InstanceRenderer", Some("m_frustumCull"), true)), "InstanceRenderer.m_frustumCull");
    }

    #[test]
    fn rejects_non_dotnet_files() {
        assert!(Metadata::parse(b"hello").is_none());
        assert!(Metadata::parse(&[0u8; 512]).is_none());
    }

    /// Read-only scan of a real profile against the installed game:
    /// `cargo test real_profile_scan -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn real_profile_scan() {
        let settings = crate::settings::Settings::load();
        let game = settings.game.expect("game set");
        let name = std::env::var("MODHEIM_SCAN_PROFILE").unwrap_or_else(|_| settings.active_profile.clone());
        let mut profile = crate::profiles::load(&name).unwrap();
        for m in &mut profile.mods {
            m.enabled = true; // scan everything, including mods that are turned off
        }
        let t = std::time::Instant::now();
        let issues = check_profile(&profile, &crate::profiles::dir(&name), &game.path);
        println!("scanned {} mods in {:?}", profile.mods.len(), t.elapsed());
        for i in &issues {
            println!("{}: {}", i.name, i.missing.join(", "));
        }
        println!("culprits for the freeze: {:?}", mods_using("MissingFieldException: Field not found: bool .InstanceRenderer.m_frustumCull Due to: Could not find field", &profile, &crate::profiles::dir(&name)));
    }

    /// Dump a game type's members: MODHEIM_DUMP_TYPE=CameraEffects cargo test dump_game_type -- --ignored --nocapture
    #[test]
    #[ignore]
    fn dump_game_type() {
        let Ok(want) = std::env::var("MODHEIM_DUMP_TYPE") else { return };
        let managed = std::path::Path::new(r"C:\XboxGames\Valheim\Content\Valheim_Data\Managed");
        for asm in ["assembly_valheim.dll", "assembly_postprocessing.dll", "assembly_sunshafts.dll"] {
            let b = std::fs::read(managed.join(asm)).unwrap();
            let (_, types) = index_assembly(&b).unwrap();
            for (name, t) in types.iter().filter(|(n, _)| want.split(',').any(|w| n.ends_with(w))) {
                let mut f: Vec<_> = t.fields.iter().collect();
                f.sort();
                let mut m: Vec<_> = t.methods.iter().collect();
                m.sort();
                println!("{asm} {name}
  fields: {f:?}
  methods: {m:?}");
            }
        }
    }
}
