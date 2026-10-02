import { supabaseAdmin } from "../../config/supabase.js";
import type { JobSearchInput } from "./job-search.schema.js";

/** Give repeat and concurrent searches one owner-scoped identity, including filters. */
export function searchRecord(userId: string, input: JobSearchInput) {
  const countries = [...new Set(input.countryCodes.map(code => code.toUpperCase()))].sort();
  const record = {
    user_id: userId,
    query: (input.historyQuery ?? input.query).trim(),
    location_mode: input.isRemote ? "remote" : input.city?.trim() ? "on-site" : "all",
    country_scope: countries.join(","),
    has_salary: input.hasSalary,
    city: input.city?.trim() || null,
  };
  return { ...record, last_used_at: new Date().toISOString() };
}

/** Save the query even when the provider returns zero jobs; retain existing stars. */
export async function saveSearch(userId: string, input: JobSearchInput) {
  if (!(input.historyQuery ?? input.query).trim()) return;
  const { error } = await supabaseAdmin.from("saved_searches")
    .upsert(searchRecord(userId, input), { onConflict: "user_id,query,location_mode,country_scope,has_salary,city" });
  if (error) throw error;
}
