// my-task original code (not derived from upstream).
export interface FolioConfig {
  logLevel: string | undefined;
  /** Supabase 프로젝트 주소(예: https://xxxx.supabase.co). */
  url: string | undefined;
  /** 접속 키. 읽기 전용으로 제한된 키를 쓰는 것이 원칙이다(시험 중에는 서비스 키 허용). */
  key: string | undefined;
  /** 논문 테이블(또는 읽기 전용 뷰) 이름. */
  table: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): FolioConfig {
  return {
    logLevel: env.LOG_LEVEL,
    url: env.FOLIO_SUPABASE_URL || undefined,
    key: env.FOLIO_SUPABASE_KEY || undefined,
    table: env.FOLIO_TABLE || "folio_papers",
  };
}
