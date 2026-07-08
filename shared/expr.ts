// Tiny safe boolean-expression evaluator for level `solved` / `openWhen` conditions.
// Grammar: ident(.prop)* | number | true | false | ! expr | expr (==|!=|>=|<=|>|<) expr
//          | expr && expr | expr || expr | ( expr )
// Identifiers resolve via a lookup function so the server owns the state model.

export type Lookup = (path: string) => number | boolean | undefined;

type Tok = { t: 'id' | 'num' | 'op' | 'lp' | 'rp'; v: string };

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  const re = /\s*(&&|\|\||==|!=|>=|<=|[!><()]|[A-Za-z_][\w.]*|\d+(?:\.\d+)?)/y;
  let i = 0;
  while (i < src.length) {
    re.lastIndex = i;
    const m = re.exec(src);
    if (!m) throw new Error(`bad token at ${i} in "${src}"`);
    const v = m[1];
    i = re.lastIndex;
    if (v === '(') toks.push({ t: 'lp', v });
    else if (v === ')') toks.push({ t: 'rp', v });
    else if (/^\d/.test(v)) toks.push({ t: 'num', v });
    else if (/^[A-Za-z_]/.test(v)) toks.push({ t: 'id', v });
    else toks.push({ t: 'op', v });
  }
  return toks;
}

export function evalExpr(src: string, lookup: Lookup): boolean {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];

  function primary(): number | boolean {
    const t = next();
    if (!t) throw new Error('unexpected end');
    if (t.t === 'lp') {
      const v = or();
      if (next()?.t !== 'rp') throw new Error('missing )');
      return v;
    }
    if (t.t === 'op' && t.v === '!') return !truthy(primary());
    if (t.t === 'num') return parseFloat(t.v);
    if (t.t === 'id') {
      if (t.v === 'true') return true;
      if (t.v === 'false') return false;
      const v = lookup(t.v);
      return v === undefined ? false : v;
    }
    throw new Error(`unexpected token ${t.v}`);
  }
  function cmp(): number | boolean {
    let l = primary();
    while (peek()?.t === 'op' && ['==', '!=', '>=', '<=', '>', '<'].includes(peek().v)) {
      const op = next().v;
      const r = primary();
      const ln = typeof l === 'boolean' ? (l ? 1 : 0) : l;
      const rn = typeof r === 'boolean' ? (r ? 1 : 0) : r;
      switch (op) {
        case '==': l = ln === rn; break;
        case '!=': l = ln !== rn; break;
        case '>=': l = ln >= rn; break;
        case '<=': l = ln <= rn; break;
        case '>': l = ln > rn; break;
        case '<': l = ln < rn; break;
      }
    }
    return l;
  }
  function and(): number | boolean {
    let l = cmp();
    while (peek()?.t === 'op' && peek().v === '&&') { next(); const r = cmp(); l = truthy(l) && truthy(r); }
    return l;
  }
  function or(): number | boolean {
    let l = and();
    while (peek()?.t === 'op' && peek().v === '||') { next(); const r = and(); l = truthy(l) || truthy(r); }
    return l;
  }
  const result = or();
  if (p !== toks.length) throw new Error(`trailing tokens in "${src}"`);
  return truthy(result);
}

function truthy(v: number | boolean): boolean {
  return typeof v === 'boolean' ? v : v !== 0;
}

/** Collect identifier paths referenced by an expression (for validation). */
export function exprIdents(src: string): string[] {
  return tokenize(src).filter((t) => t.t === 'id' && t.v !== 'true' && t.v !== 'false').map((t) => t.v);
}
