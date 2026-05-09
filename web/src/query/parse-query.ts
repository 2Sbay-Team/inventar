import { tokenise } from './tokenise';
import { expandColourAlias } from './colour-aliases';

// SPEC §2.2 search behaviour. Two output streams:
//   - generalTokens — expanded with colour aliases; every group must hit the
//     search_blob for the article to be a candidate. (`group` is the alias
//     set; ANY alias matching counts as hitting the group.)
//   - sizeTokens — numeric-only tokens. Don't filter by themselves; they
//     drive ranking + the stock-badge text on the result card.

export interface ParsedQuery {
  raw: string;
  generalTokens: ReadonlyArray<readonly string[]>;
  sizeTokens: readonly string[];
  isEmpty: boolean;
}

const SIZE_RE = /^[0-9]+(?:[.,][0-9]+)?$/;

export function parseQuery(raw: string): ParsedQuery {
  const tokens = tokenise(raw);
  const generalTokens: string[][] = [];
  const sizeTokens: string[] = [];
  for (const t of tokens) {
    if (SIZE_RE.test(t)) {
      sizeTokens.push(t);
    } else {
      generalTokens.push([...expandColourAlias(t)]);
    }
  }
  return {
    raw,
    generalTokens,
    sizeTokens,
    isEmpty: tokens.length === 0,
  };
}
