//! Parser / structural validator for DSL v1.2 (mirrors `parse.ts`).

use paradigm_terra_canonical::jcs::JcsValue;

use crate::ast::{
    ArithOp, CmpOp, ConstVal, Expr, Scope, Version, MAX_DEPTH, MAX_EXPRESSION_COST, MAX_NODES,
    MAX_PATH_SEGMENTS, MAX_PATH_SEGMENTS_BRACKETED,
};
use crate::errors::{DResult, DslError};
use crate::i256::I256;
use crate::taxonomy::is_registered_action;

const C_BINARY: u64 = 1;
const C_CONTAINS_KEY: u64 = 10;
const C_SIZE: u64 = 20;
const C_GATE_OP: u64 = 5;
const C_PATH_SEGMENT: u64 = 2;

struct Ctx {
    scope: Scope,
    version: Version,
    nodes: usize,
    cost: u64,
}

fn obj_pairs(j: &JcsValue) -> Option<&Vec<(String, JcsValue)>> {
    match j {
        JcsValue::Object(p) => Some(p),
        _ => None,
    }
}

fn obj_get<'a>(pairs: &'a [(String, JcsValue)], key: &str) -> Option<&'a JcsValue> {
    pairs.iter().find(|(k, _)| k == key).map(|(_, v)| v)
}

fn obj_keys(pairs: &[(String, JcsValue)]) -> Vec<&str> {
    pairs.iter().map(|(k, _)| k.as_str()).collect()
}

fn is_bytes32(s: &str) -> bool {
    s.len() == 66 && s.starts_with("0x") && s[2..].bytes().all(|b| b.is_ascii_hexdigit())
}

fn is_address_shaped(s: &str) -> bool {
    let Some((wc, hash)) = s.split_once(':') else {
        return false;
    };
    if hash.len() != 64 || !hash.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')) {
        return false;
    }
    let wc = wc.strip_prefix('-').unwrap_or(wc);
    !wc.is_empty() && wc.bytes().all(|b| b.is_ascii_digit())
}

impl Ctx {
    fn bump_node(&mut self) -> DResult<()> {
        self.nodes += 1;
        if self.nodes > MAX_NODES {
            return Err(DslError::parse("NODE_LIMIT"));
        }
        Ok(())
    }
    fn add_cost(&mut self, c: u64) -> DResult<()> {
        self.cost += c;
        if self.cost > MAX_EXPRESSION_COST {
            return Err(DslError::validation("COST_EXCEEDED"));
        }
        Ok(())
    }
}

fn build_const(value: &JcsValue) -> DResult<Expr> {
    match value {
        JcsValue::Int(s) => match I256::from_dec_str(s) {
            Some(i) => Ok(Expr::Const(ConstVal::Int(i))),
            None => Err(DslError::validation("INT256_RANGE")),
        },
        JcsValue::Bool(b) => Ok(Expr::Const(ConstVal::Bool(*b))),
        JcsValue::Null => Ok(Expr::Const(ConstVal::Null)),
        JcsValue::Str(s) => {
            if is_bytes32(s) {
                Ok(Expr::Const(ConstVal::Bytes32(format!("0x{}", s[2..].to_lowercase()))))
            } else if is_address_shaped(s) {
                Ok(Expr::Const(ConstVal::Address(s.clone())))
            } else {
                Ok(Expr::Const(ConstVal::Str(s.clone())))
            }
        }
        JcsValue::Array(_) | JcsValue::Object(_) => Err(DslError::validation("NO_COLLECTION_LITERAL")),
    }
}

fn build_var(ctx: &mut Ctx, raw: &str) -> DResult<Expr> {
    if raw.is_empty() || raw.starts_with('.') || raw.ends_with('.') || raw.contains("..") {
        return Err(DslError::parse("MALFORMED_PATH"));
    }
    let path: Vec<String> = raw.split('.').map(|s| s.to_string()).collect();
    let root = path[0].as_str();
    let bracketed = root == "state" && (path.get(1).map(|s| s.as_str()) == Some("before") || path.get(1).map(|s| s.as_str()) == Some("after"));

    let limit = if bracketed { MAX_PATH_SEGMENTS_BRACKETED } else { MAX_PATH_SEGMENTS };
    if path.len() > limit {
        return Err(DslError::parse("PATH_TOO_DEEP"));
    }

    match root {
        "params" => {}
        "state" => {
            if bracketed {
                if ctx.scope != Scope::PostCondition && ctx.scope != Scope::Invariant {
                    return Err(DslError::parse("BRACKETED_STATE_OUT_OF_SCOPE"));
                }
                if ctx.version == Version::V11 {
                    return Err(DslError::validation("V11_UNSUPPORTED"));
                }
            }
        }
        "capability" | "signatures" => {
            if ctx.scope != Scope::Gate {
                return Err(DslError::parse("GATE_VAR_OUT_OF_SCOPE"));
            }
        }
        _ => return Err(DslError::parse("UNKNOWN_VAR_ROOT")),
    }

    ctx.add_cost(C_PATH_SEGMENT * path.len() as u64)?;
    Ok(Expr::Var { raw: raw.to_string(), path })
}

fn build_action(ctx: &mut Ctx, action: &JcsValue) -> DResult<Expr> {
    let JcsValue::Str(a) = action else {
        return Err(DslError::parse("MALFORMED_ACTION"));
    };
    if ctx.scope != Scope::Gate {
        return Err(DslError::parse("ACTION_OUT_OF_SCOPE"));
    }
    if ctx.version == Version::V11 {
        return Err(DslError::validation("V11_UNSUPPORTED"));
    }
    if !is_registered_action(a) {
        return Err(DslError::parse("UNKNOWN_ACTION"));
    }
    Ok(Expr::Action(a.clone()))
}

fn require_keys(keys: &[&str], allowed: &[&str]) -> DResult<()> {
    for k in keys {
        if !allowed.contains(k) {
            return Err(DslError::validation("UNEXPECTED_KEY"));
        }
    }
    Ok(())
}

fn build_op(ctx: &mut Ctx, pairs: &[(String, JcsValue)], depth: usize) -> DResult<Expr> {
    let JcsValue::Str(op) = obj_get(pairs, "op").unwrap() else {
        return Err(DslError::parse("MALFORMED_NODE"));
    };
    let op = op.as_str();
    let keys = obj_keys(pairs);

    let get_child = |ctx: &mut Ctx, key: &str, depth: usize| -> DResult<Box<Expr>> {
        Ok(Box::new(build(ctx, obj_get(pairs, key).unwrap(), depth + 1)?))
    };

    // Binary arithmetic / comparison / (n)eq → { op, lhs, rhs }
    let arith = matches!(op, "add" | "sub" | "mul" | "div" | "mod");
    let cmp = matches!(op, "lt" | "lte" | "gt" | "gte");
    if arith || cmp || op == "eq" || op == "neq" {
        require_keys(&keys, &["op", "lhs", "rhs"])?;
        if obj_get(pairs, "lhs").is_none() || obj_get(pairs, "rhs").is_none() {
            return Err(DslError::validation("ARITY"));
        }
        ctx.add_cost(C_BINARY)?;
        let lhs = get_child(ctx, "lhs", depth)?;
        let rhs = get_child(ctx, "rhs", depth)?;
        return Ok(if arith {
            Expr::Arith {
                op: match op {
                    "add" => ArithOp::Add,
                    "sub" => ArithOp::Sub,
                    "mul" => ArithOp::Mul,
                    "div" => ArithOp::Div,
                    _ => ArithOp::Mod,
                },
                lhs,
                rhs,
            }
        } else if cmp {
            Expr::Cmp {
                op: match op {
                    "lt" => CmpOp::Lt,
                    "lte" => CmpOp::Lte,
                    "gt" => CmpOp::Gt,
                    _ => CmpOp::Gte,
                },
                lhs,
                rhs,
            }
        } else {
            Expr::Eq { neg: op == "neq", lhs, rhs }
        });
    }

    match op {
        "and" | "or" => {
            require_keys(&keys, &["op", "args"])?;
            let Some(JcsValue::Array(args)) = obj_get(pairs, "args") else {
                return Err(DslError::validation("ARITY"));
            };
            if args.len() < 2 {
                return Err(DslError::validation("ARITY"));
            }
            ctx.add_cost(C_BINARY)?;
            let mut out = Vec::with_capacity(args.len());
            for a in args {
                out.push(build(ctx, a, depth + 1)?);
            }
            Ok(Expr::Bool { is_and: op == "and", args: out })
        }
        "not" => {
            require_keys(&keys, &["op", "arg"])?;
            if obj_get(pairs, "arg").is_none() {
                return Err(DslError::validation("ARITY"));
            }
            ctx.add_cost(C_BINARY)?;
            Ok(Expr::Not(get_child(ctx, "arg", depth)?))
        }
        "size" => {
            require_keys(&keys, &["op", "arg"])?;
            if obj_get(pairs, "arg").is_none() {
                return Err(DslError::validation("ARITY"));
            }
            ctx.add_cost(C_SIZE)?;
            Ok(Expr::Size(get_child(ctx, "arg", depth)?))
        }
        "contains_key" => {
            require_keys(&keys, &["op", "lhs", "rhs"])?;
            if obj_get(pairs, "lhs").is_none() || obj_get(pairs, "rhs").is_none() {
                return Err(DslError::validation("ARITY"));
            }
            ctx.add_cost(C_CONTAINS_KEY)?;
            let map = get_child(ctx, "lhs", depth)?;
            let key = get_child(ctx, "rhs", depth)?;
            Ok(Expr::ContainsKey { map, key })
        }
        "requires_scope" => {
            if ctx.scope != Scope::Gate {
                return Err(DslError::parse("GATE_OP_OUT_OF_SCOPE"));
            }
            if ctx.version == Version::V11 {
                return Err(DslError::validation("V11_UNSUPPORTED"));
            }
            require_keys(&keys, &["op", "args"])?;
            let args = expect_args(pairs, 2, op)?;
            ctx.add_cost(C_GATE_OP)?;
            let action = Box::new(build(ctx, &args[0], depth + 1)?);
            let scope = Box::new(build(ctx, &args[1], depth + 1)?);
            Ok(Expr::RequiresScope { action, scope })
        }
        "is_owner_required" => {
            if ctx.scope != Scope::Gate {
                return Err(DslError::parse("GATE_OP_OUT_OF_SCOPE"));
            }
            if ctx.version == Version::V11 {
                return Err(DslError::validation("V11_UNSUPPORTED"));
            }
            require_keys(&keys, &["op", "args"])?;
            let args = expect_args(pairs, 1, op)?;
            ctx.add_cost(C_GATE_OP)?;
            let action = Box::new(build(ctx, &args[0], depth + 1)?);
            Ok(Expr::IsOwnerRequired { action })
        }
        _ => Err(DslError::validation("UNKNOWN_OPERATOR")),
    }
}

fn expect_args<'a>(pairs: &'a [(String, JcsValue)], n: usize, _op: &str) -> DResult<&'a [JcsValue]> {
    let Some(JcsValue::Array(args)) = obj_get(pairs, "args") else {
        return Err(DslError::validation("ARITY"));
    };
    if args.len() != n {
        return Err(DslError::validation("ARITY"));
    }
    Ok(args)
}

fn build(ctx: &mut Ctx, j: &JcsValue, depth: usize) -> DResult<Expr> {
    if depth > MAX_DEPTH {
        return Err(DslError::parse("DEPTH_LIMIT"));
    }
    ctx.bump_node()?;

    let Some(pairs) = obj_pairs(j) else {
        return Err(DslError::parse("MALFORMED_NODE"));
    };

    let has_const = obj_get(pairs, "const").is_some();
    let has_var = obj_get(pairs, "var").is_some();
    let has_action = obj_get(pairs, "action").is_some();
    let has_op = obj_get(pairs, "op").is_some();
    let discriminants = [has_const, has_var, has_action, has_op].iter().filter(|b| **b).count();
    if discriminants != 1 {
        return Err(DslError::parse("MALFORMED_NODE"));
    }

    if has_const {
        if pairs.len() != 1 {
            return Err(DslError::parse("MALFORMED_NODE"));
        }
        return build_const(obj_get(pairs, "const").unwrap());
    }
    if has_var {
        if pairs.len() != 1 {
            return Err(DslError::parse("MALFORMED_NODE"));
        }
        let JcsValue::Str(raw) = obj_get(pairs, "var").unwrap() else {
            return Err(DslError::parse("MALFORMED_NODE"));
        };
        return build_var(ctx, raw);
    }
    if has_action {
        if pairs.len() != 1 {
            return Err(DslError::parse("MALFORMED_NODE"));
        }
        return build_action(ctx, obj_get(pairs, "action").unwrap());
    }
    build_op(ctx, pairs, depth)
}

pub fn parse_expression(j: &JcsValue, scope: Scope, version: Version) -> DResult<Expr> {
    let mut ctx = Ctx { scope, version, nodes: 0, cost: 0 };
    build(&mut ctx, j, 1)
}

/// Static, data-independent cost of a parsed expression (DSL v1.1 §3.2, CAL §9.2).
/// Mirrors `expressionCost` in `parse.ts`: validate the AST, then return the
/// accumulated cost. The gas layer (`cal-gas`) reuses this so the DSL portion of
/// a CAL's gas is the exact numbers the DSL already pins.
pub fn expression_cost(j: &JcsValue, scope: Scope, version: Version) -> DResult<u64> {
    let mut ctx = Ctx { scope, version, nodes: 0, cost: 0 };
    build(&mut ctx, j, 1)?;
    Ok(ctx.cost)
}
