/** Mirror the Flutter profile projection: skill details collapse, arrays use item keys. */
export function scoreProjection(profile: any): Record<string, any> {
  function project(value: any): any {
    if (Array.isArray(value)) {
      if (!value.every(item => typeof item === "string")) throw new Error("Profile arrays must contain strings.");
      return Object.fromEntries(value.map(item => [item, true]));
    }
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, project(child)]));
    if (["string", "number", "boolean"].includes(typeof value)) return true;
    throw new Error("Invalid candidate profile value.");
  }
  const skills = project(profile.skills_interests_schema ?? {});
  if (profile.skills_interests_schema?.skills) {
    skills.skills = Object.fromEntries(Object.entries(profile.skills_interests_schema.skills).map(([category, values]) => [category,
      Object.fromEntries(Object.keys(values as object).map(name => [name, true]))]));
  }
  return { skills_interests_schema: skills, behavioral_points_schema: project(profile.behavioral_points_schema ?? {}) };
}

/** Validate exact score paths before a provider result may become a stored rating. */
export function validateAnalysis(analysis: any, projection: Record<string, any>) {
  function validate(value: any, shape: any): void {
    if (shape === true) {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) throw new Error("Invalid ranking score.");
      return;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).sort().join("\0") !== Object.keys(shape).sort().join("\0")) throw new Error("Ranking score paths differ from the candidate profile.");
    for (const key of Object.keys(shape)) validate(value[key], shape[key]);
  }
  for (const root of Object.keys(projection)) validate(analysis?.candidate_match?.[root], projection[root]);
  const object = (value: any) => value !== null && typeof value === "object" && !Array.isArray(value);
  if (!object(analysis?.job_summary)
    || !object(analysis.job_summary.skills_interests_schema)
    || !object(analysis.job_summary.behavioral_points_schema)
    || !Array.isArray(analysis?.candidate_match?.matches)) throw new Error("Incomplete ranking analysis.");
  for (const match of analysis.candidate_match.matches) {
    if (!object(match) || ["skill_or_requirement", "reason", "evidence"]
      .some(field => typeof match[field] !== "string" || !match[field].trim())) {
      throw new Error("Invalid ranking match evidence.");
    }
  }
}

/** Ask Jev one ordinal fit question for each candidate leaf, then normalize to [0,1]. */
export async function rankWithJev(input: { description: string; cv: string; profile: any; schema: unknown; model: string }) {
  const projection = scoreProjection(input.profile);
  const questions: Record<string, any> = {};
  const paths: string[][] = [];
  const criteria = ["Not related to this job.", "Tangentially related to this job.", "Strongly related to this job.", "A specific, direct match for this job."];
  function walk(shape: any, path: string[]) {
    if (shape !== true) {
      for (const key of Object.keys(shape)) walk(shape[key], [...path, key]);
      return;
    }
    let value: any = input.profile;
    for (const key of path) value = Array.isArray(value) ? key : value?.[key] ?? key;
    const id = `q${paths.length.toString().padStart(4, "0")}`;
    paths.push(path);
    questions[id] = { type: "score", instructions: `Rate how well the job fits the candidate profile item at exact path ${JSON.stringify(path)} with candidate value ${JSON.stringify(value)}. Use the job description to judge relevance and the candidate profile to understand the item. Rate match strength, not answer confidence. Do not infer that a profile item is a job requirement merely because the candidate has it.`, criteria };
  }
  walk(projection, []);
  if (paths.length === 0) {
    return { analysis: { job_summary: { skills_interests_schema: {}, behavioral_points_schema: {} },
      candidate_match: { ...projection, matches: [] } }, model: input.model };
  }
  const key = process.env.TYPESAFE_API_KEY?.trim();
  if (!key) throw new Error("TYPESAFE_API_KEY is not configured on the backend.");
  const response = await fetch("https://api.typesafe.ai/v1/systemone", {
    method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: input.model, state: { job_description: input.description, candidate_resume: input.cv, candidate_profile: input.profile, ranking_schema: input.schema }, questions }),
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok) throw new Error(`Jev returned status ${response.status}.`);
  const result = await response.json() as any;
  if (!result.answers || Object.keys(result.answers).length !== paths.length || typeof result.model !== "string") throw new Error("Incomplete Jev response.");
  const trees = structuredClone(projection);
  paths.forEach((path, index) => {
    const answer = result.answers[`q${index.toString().padStart(4, "0")}`];
    if (answer?.type !== "score" || typeof answer.score !== "number" || !Number.isFinite(answer.score) || answer.score < 0 || answer.score > 3) throw new Error("Invalid Jev score.");
    let target = trees;
    for (const key of path.slice(0, -1)) target = target[key];
    target[path.at(-1)!] = answer.score / 3;
  });
  return { analysis: { job_summary: { skills_interests_schema: {}, behavioral_points_schema: {} }, candidate_match: { ...trees, matches: [] } }, model: result.model };
}
