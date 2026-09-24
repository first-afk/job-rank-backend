export function buildRankingPrompt(input: {
  jobDescription: string;
  cvContent: string;
  skillsProfile: unknown;
  schema: unknown;
}) {
  return `
You are an expert job analyst and resume matcher.
Your task is to analyze a given job description against a candidate's resume and skills.
You will produce a single JSON object containing two main sections:
1.  **Job Summary**: A summary of the job's skill requirements, areas of specialization, and desired candidate behavioral traits, based on the provided schema.
2.  **Candidate Match**: A detailed fuzzy match analysis. For any original array fields (like 'areas_of_interest' or 'adaptability' in the schema), convert them into **JSON objects** where the original array item is the key, and you assign a score (0.0 to 1.0) as the value. A 1.0 means a specific match, 0.5 means tangentially related. For individual skill/trait matches, provide a concise explanation and *specific, brief evidence* from the candidate's resume.
If compensation or salary information is present in the job description/API data, preserve it under job_summary.skills_interests_schema.compensation. If no salary is present, set has_salary to false and leave unknown fields empty.

Here are the inputs:
---

Job Description:
${input.jobDescription}

Candidate's Full Resume Content:
${input.cvContent}

Candidate's Skills:
${JSON.stringify(input.skillsProfile, null, 2)}

Job Schema:
${JSON.stringify(input.schema, null, 2)}
---

IMPORTANT: Your response MUST be valid JSON and contain ONLY the JSON. Do NOT include any conversational text or markdown code blocks (e.g., """json). The top-level JSON structure should be:
{
  "job_summary": {
    "skills_interests_schema": {
      // Structure based on schemaContent, summarizing job requirements
      "skills": { /* ... */ },
      "areas_of_interest": { /* object with scored items, e.g., "AI systems design": 1.0 */ },
      "professional_background": { /* ... */ },
      "compensation": {
        "has_salary": true,
        "salary_range": "...",
        "currency": "...",
        "pay_period": "...",
        "notes": "..."
      }
    },
    "behavioral_points_schema": {
      // Structure based on schemaContent, summarizing behavioral requirements
      "work_preferences": { /* ... */ },
      "career_aspirations": { /* ... */ },
      "adaptability": { /* object with scored items, e.g., "Adapting to changing requirements": 1.0 */ },
      "personal_traits": { /* ... */ }
    }
  },
  "candidate_match": {
    "skills_interests_schema": {
      // This section should mirror the structure of skillsContent, but with 0.0-1.0 scores
      "skills": {
        "programming_languages": { "Python": 1.0, "C++": 0.5, /* ... */ },
        // ... other skill categories
      },
      "areas_of_interest": { /* object with scored items, e.g., "Autonomous systems": 1.0 */ },
      "professional_background": { /* ... */ }
    },
    "behavioral_points_schema": {
      // This section should mirror the structure of skillsContent, but with 0.0-1.0 scores
      "work_preferences": { /* ... */ },
      "career_aspirations": { /* ... */ },
      "adaptability": { /* object with scored items, e.g., "Open to pivoting strategies": 1.0 */ },
      "personal_traits": { /* ... */ }
    },
    "matches": [
      {"skill_or_requirement": "...", "reason": "...", "evidence": "..."}
    ]
  }
}
Ensure all keys in the example structure are present in your output. For fields that were originally arrays (like 'areas_of_interest' or 'adaptability' in the provided schema/skills JSON), ensure they are converted to **JSON objects with scored items** in the output of the 'candidate_match' section. """
`;
}
