//! Validated DSL v1.2 AST + scope/version/limit definitions (mirrors `ast.ts`).

use crate::i256::I256;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Scope {
    Precondition,
    PostCondition,
    Invariant,
    Gate,
}

impl Scope {
    pub fn from_str(s: &str) -> Option<Scope> {
        match s {
            "precondition" => Some(Scope::Precondition),
            "post_condition" => Some(Scope::PostCondition),
            "invariant" => Some(Scope::Invariant),
            "gate" => Some(Scope::Gate),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Version {
    V11,
    V12,
}

impl Version {
    pub fn from_str(s: &str) -> Option<Version> {
        match s {
            "1.1" => Some(Version::V11),
            "1.2" => Some(Version::V12),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CmpOp {
    Lt,
    Lte,
    Gt,
    Gte,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ArithOp {
    Add,
    Sub,
    Mul,
    Div,
    Mod,
}

#[derive(Debug, Clone)]
pub enum ConstVal {
    Int(I256),
    Bool(bool),
    Str(String),
    Bytes32(String),
    Address(String),
    Null,
}

#[derive(Debug, Clone)]
pub enum Expr {
    Const(ConstVal),
    Var { raw: String, path: Vec<String> },
    Action(String),
    Eq { neg: bool, lhs: Box<Expr>, rhs: Box<Expr> },
    Cmp { op: CmpOp, lhs: Box<Expr>, rhs: Box<Expr> },
    Arith { op: ArithOp, lhs: Box<Expr>, rhs: Box<Expr> },
    Bool { is_and: bool, args: Vec<Expr> },
    Not(Box<Expr>),
    ContainsKey { map: Box<Expr>, key: Box<Expr> },
    Size(Box<Expr>),
    RequiresScope { action: Box<Expr>, scope: Box<Expr> },
    IsOwnerRequired { action: Box<Expr> },
}

pub const MAX_DEPTH: usize = 10;
pub const MAX_NODES: usize = 100;
pub const MAX_PATH_SEGMENTS: usize = 6;
pub const MAX_PATH_SEGMENTS_BRACKETED: usize = 7;
pub const MAX_EXPRESSION_COST: u64 = 1000;
