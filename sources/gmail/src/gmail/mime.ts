// my-task original code (not derived from upstream).
// Gmail API가 돌려주는 메일 구조를 사람이 읽을 텍스트로 바꾼다. 네트워크 없음.

export interface GmailHeader {
  name?: string | null;
  value?: string | null;
}

export interface GmailPart {
  mimeType?: string | null;
  filename?: string | null;
  headers?: GmailHeader[] | null;
  body?: { data?: string | null; size?: number | null } | null;
  parts?: GmailPart[] | null;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", mdash: "—", ndash: "–",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", copy: "©", middot: "·", bull: "•", times: "×",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith("#")) {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** 지원하지 않는 문자 집합 이름이면 UTF-8로 대신한다. */
function decodeBytes(bytes: Uint8Array, charset?: string): string {
  try {
    return new TextDecoder(charset?.trim().replace(/^"|"$/g, "") || "utf-8").decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

export function decodeBase64Url(data: string, charset?: string): string {
  return decodeBytes(Buffer.from(data, "base64url"), charset);
}

/** 제목 등의 RFC 2047 인코딩(`=?UTF-8?B?...?=`)을 푼다. 이미 풀려 있는 값은 그대로 둔다. */
export function decodeEncodedWords(value: string): string {
  const joined = value.replace(/(\?=)\s+(=\?)/g, "$1$2");
  return joined.replace(/=\?([^?\s]+)\?([bBqQ])\?([^?]*)\?=/g, (whole, charset: string, enc: string, data: string) => {
    try {
      if (enc.toLowerCase() === "b") return decodeBytes(Buffer.from(data, "base64"), charset);
      const q = data.replace(/_/g, " ").replace(/=([0-9a-fA-F]{2})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)));
      return decodeBytes(Uint8Array.from(q, (c) => c.charCodeAt(0)), charset);
    } catch {
      return whole;
    }
  });
}

export function headerValue(headers: GmailHeader[] | null | undefined, name: string): string | undefined {
  const found = headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value;
  return found == null ? undefined : decodeEncodedWords(found).trim();
}

/** HTML을 텍스트로: 스크립트·스타일·주석을 버리고, 줄바꿈 태그는 줄바꿈으로, 나머지 태그는 지운다. */
export function htmlToText(html: string): string {
  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|head)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table|blockquote)\s*>/gi, "\n")
    .replace(/<[^>]*>/g, " ");
  return decodeEntities(stripped)
    .replace(/[ \t\f\v ]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function partCharset(part: GmailPart): string | undefined {
  return /charset="?([^";\s]+)"?/i.exec(headerValue(part.headers, "Content-Type") ?? "")?.[1];
}

function decodePart(part: GmailPart): string {
  const data = part.body?.data;
  return data ? decodeBase64Url(data, partCharset(part)) : "";
}

export interface ExtractedBody {
  text: string;
  /** 본문을 어디서 얻었는지. 일반 텍스트가 있으면 그것을 쓴다. */
  source: "plain" | "html" | "none";
}

/** 메일의 부분들을 재귀로 훑어 첨부가 아닌 일반 텍스트를 모으고, 없으면 HTML을 텍스트로 바꾼다. */
export function extractBody(payload: GmailPart | null | undefined): ExtractedBody {
  const plain: string[] = [];
  const html: string[] = [];
  const walk = (part: GmailPart): void => {
    const type = (part.mimeType ?? "").toLowerCase();
    const isAttachment = Boolean(part.filename);
    if (!isAttachment && type === "text/plain") plain.push(decodePart(part));
    else if (!isAttachment && type === "text/html") html.push(decodePart(part));
    for (const child of part.parts ?? []) walk(child);
  };
  if (payload) walk(payload);
  const plainText = plain.join("\n").trim();
  if (plainText) return { text: plainText, source: "plain" };
  const htmlText = htmlToText(html.join("\n"));
  return htmlText ? { text: htmlText, source: "html" } : { text: "", source: "none" };
}

/** 코드 포인트 기준으로 자른다(이모지 같은 두 칸짜리 문자를 반으로 가르지 않는다). */
export function truncateText(text: string, limit: number): { text: string; truncated: boolean; originalLength: number } {
  const points = Array.from(text);
  if (points.length <= limit) return { text, truncated: false, originalLength: points.length };
  return { text: points.slice(0, limit).join(""), truncated: true, originalLength: points.length };
}
