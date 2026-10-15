// my-task original code (not derived from upstream).
import { z } from "zod";

/** 모델이 내는 일정·할 일 후보. 날짜는 소스에 적힌 것만, 근거는 소스 원문의 인용이어야 한다. */
export const CandidateSchema = z.object({
  title: z.string().min(1).max(200),
  /** 소스에 명확히 적힌 마감(YYYY-MM-DD). 확실하지 않으면 null. */
  due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  /** `due`를 뒷받침하는 소스 원문의 인용. `due`가 있으면 필수. */
  dueEvidence: z.string().max(300).nullable().default(null),
  source: z.enum(["mail", "github"]),
  /** 메일 id 또는 GitHub 항목 id. 입력에 있던 것이어야 한다. */
  sourceId: z.string().min(1),
  /** 이 일이 소스에 있다는 근거 인용. 비어 있으면 코드가 그 후보만 버린다(응답 전체를 버리지 않는다). */
  evidence: z.string().max(300),
});
export type Candidate = z.infer<typeof CandidateSchema>;

/** 비서의 한마디: 사실 주장마다 소스나 To Do 데이터에서 따온 근거 인용을 붙인다. */
export const SentenceSchema = z.object({ text: z.string().min(1).max(300), evidence: z.string().max(300) });
export type Sentence = z.infer<typeof SentenceSchema>;

/** 개수는 여기서 거부하지 않는다(너무 많으면 코드가 앞에서부터 잘라 쓴다). 개수로 거부하면 지시문이 섞인 메일 한 통이 모델 단계 전체를 무력화할 수 있다. */
export const ModelOutputSchema = z.object({
  candidates: z.array(CandidateSchema),
  remark: z.array(SentenceSchema),
});
export const MAX_CANDIDATES = 50;
export const MAX_REMARK = 4;
export type ModelOutput = z.infer<typeof ModelOutputSchema>;
