// Canonical skill taxonomy for the live jobs pipeline. Each canonical skill has
// a set of lowercase match terms; a job "demands" a skill when any term appears
// in its title or description. Tuned to the resources / energy / finance /
// industrial roster, plus cross-cutting trades, safety, data and corporate
// skills. Kept dependency-free so the Cloudflare cron worker and the app can
// both import it.

export interface SkillDef {
  skill: string; // canonical display name
  cat: string; // grouping for the legend
  terms: string[]; // lowercase substrings matched against title + description
}

export const SKILLS: SkillDef[] = [
  // ── Mining & geoscience ────────────────────────────────────────────────
  { skill: 'Mining Engineering', cat: 'Mining', terms: ['mining engineer', 'mine engineer', 'mining engineering'] },
  { skill: 'Geology', cat: 'Mining', terms: ['geologist', 'geology', 'geoscience', 'exploration geo'] },
  { skill: 'Metallurgy', cat: 'Mining', terms: ['metallurg', 'metallurgy', 'processing plant', 'mineral processing'] },
  { skill: 'Drill & Blast', cat: 'Mining', terms: ['drill and blast', 'drill & blast', 'blasting', 'shotfirer'] },
  { skill: 'Surveying', cat: 'Mining', terms: ['surveyor', 'mine survey', 'surveying'] },
  { skill: 'Geotechnical', cat: 'Mining', terms: ['geotechnical', 'geotech', 'ground control'] },
  { skill: 'Underground Mining', cat: 'Mining', terms: ['underground mine', 'underground mining', 'jumbo operator'] },
  { skill: 'Fixed Plant Maintenance', cat: 'Mining', terms: ['fixed plant', 'processing maintenance'] },

  // ── Oil, gas & energy ──────────────────────────────────────────────────
  { skill: 'Process Engineering', cat: 'Energy', terms: ['process engineer', 'process engineering'] },
  { skill: 'Subsea Engineering', cat: 'Energy', terms: ['subsea', 'sub-sea'] },
  { skill: 'Pipeline Engineering', cat: 'Energy', terms: ['pipeline'] },
  { skill: 'LNG Operations', cat: 'Energy', terms: ['lng', 'liquefied natural gas', 'gas plant'] },
  { skill: 'Drilling & Wells', cat: 'Energy', terms: ['drilling', 'well engineer', 'wells', 'petroleum engineer', 'reservoir'] },
  { skill: 'Hydrogen & Renewables', cat: 'Energy', terms: ['hydrogen', 'renewable', 'solar', 'wind farm', 'electrolyser'] },
  { skill: 'Decarbonisation', cat: 'Energy', terms: ['decarbon', 'net zero', 'emissions reduction', 'carbon capture'] },
  { skill: 'Electrical Engineering', cat: 'Engineering', terms: ['electrical engineer', 'electrical engineering', 'high voltage', 'hv '] },
  { skill: 'Mechanical Engineering', cat: 'Engineering', terms: ['mechanical engineer', 'mechanical engineering', 'rotating equipment'] },
  { skill: 'Civil Engineering', cat: 'Engineering', terms: ['civil engineer', 'civil engineering', 'structural engineer'] },
  { skill: 'Instrumentation & Control', cat: 'Engineering', terms: ['instrumentation', 'control systems', 'e&i', 'plc', 'scada'] },

  // ── Trades & operations ────────────────────────────────────────────────
  { skill: 'Heavy Diesel Mechanic', cat: 'Trades', terms: ['diesel mechanic', 'heavy diesel', 'hd fitter', 'plant mechanic'] },
  { skill: 'Boilermaker / Welder', cat: 'Trades', terms: ['boilermaker', 'welder', 'welding', 'fabricator'] },
  { skill: 'Electrician', cat: 'Trades', terms: ['electrician', 'electrical trade', 'a grade electric'] },
  { skill: 'Fitter', cat: 'Trades', terms: ['mechanical fitter', 'fitter and turner', 'maintenance fitter'] },
  { skill: 'Heavy Equipment Operator', cat: 'Trades', terms: ['operator', 'haul truck', 'dump truck', 'excavator', 'dozer', 'loader'] },
  { skill: 'Trades Assistant', cat: 'Trades', terms: ['trades assistant', 'ta '] },
  { skill: 'Rigging & Scaffolding', cat: 'Trades', terms: ['rigger', 'scaffolder', 'scaffolding', 'dogman'] },

  // ── HSE & quality ──────────────────────────────────────────────────────
  { skill: 'HSE / Safety', cat: 'Safety', terms: ['hse', 'health and safety', 'safety advisor', 'safety officer', 'whs', 'ohs'] },
  { skill: 'Environmental', cat: 'Safety', terms: ['environmental', 'environment advisor', 'rehabilitation', 'tailings'] },
  { skill: 'Risk & Compliance', cat: 'Safety', terms: ['risk', 'compliance', 'assurance', 'governance'] },
  { skill: 'Quality Assurance', cat: 'Safety', terms: ['quality assurance', 'qa/qc', 'quality control'] },
  { skill: 'Radiation Safety', cat: 'Safety', terms: ['radiation', 'radiological'] },

  // ── Data, digital & automation ─────────────────────────────────────────
  { skill: 'Data Analytics', cat: 'Digital', terms: ['data analyst', 'data analytics', 'power bi', 'analytics', 'sql'] },
  { skill: 'Data Science & ML', cat: 'Digital', terms: ['data scien', 'machine learning', 'ml engineer', 'ai '] },
  { skill: 'Software Engineering', cat: 'Digital', terms: ['software engineer', 'developer', 'full stack', 'python', 'java', 'react'] },
  { skill: 'Cloud & DevOps', cat: 'Digital', terms: ['cloud', 'aws', 'azure', 'devops', 'kubernetes'] },
  { skill: 'Cybersecurity', cat: 'Digital', terms: ['cyber', 'security engineer', 'infosec'] },
  { skill: 'Automation & Robotics', cat: 'Digital', terms: ['automation', 'autonomous', 'robotics', 'remote operations'] },
  { skill: 'IT & Systems', cat: 'Digital', terms: ['it support', 'systems administrator', 'sap', 'erp', 'network engineer'] },

  // ── Corporate & commercial ─────────────────────────────────────────────
  { skill: 'Project Management', cat: 'Corporate', terms: ['project manager', 'project management', 'project engineer', 'pmo'] },
  { skill: 'Finance & Accounting', cat: 'Corporate', terms: ['accountant', 'finance', 'financial analyst', 'cfo', 'payroll', 'tax'] },
  { skill: 'Procurement & Supply', cat: 'Corporate', terms: ['procurement', 'supply chain', 'contracts', 'logistics', 'warehouse'] },
  { skill: 'Human Resources', cat: 'Corporate', terms: ['human resources', 'hr ', 'people and culture', 'recruit', 'talent'] },
  { skill: 'Commercial & Legal', cat: 'Corporate', terms: ['commercial', 'legal', 'lawyer', 'counsel', 'contract administrat'] },
  { skill: 'Marketing & Comms', cat: 'Corporate', terms: ['marketing', 'communications', 'media', 'brand', 'content'] },
  { skill: 'Sales & Business Dev', cat: 'Corporate', terms: ['sales', 'business development', 'account manager', 'account executive'] },
  { skill: 'Community & Native Title', cat: 'Corporate', terms: ['community relations', 'stakeholder', 'native title', 'indigenous engagement', 'heritage'] },

  // ── Sector-specific ────────────────────────────────────────────────────
  { skill: 'Retail Operations', cat: 'Sector', terms: ['retail', 'store manager', 'merchandis', 'customer service'] },
  { skill: 'Banking & Lending', cat: 'Sector', terms: ['banking', 'lending', 'credit', 'mortgage', 'loans'] },
  { skill: 'Telecommunications', cat: 'Sector', terms: ['telecommunications', 'telco', 'network operations', 'fibre'] },
  { skill: 'Shipbuilding & Marine', cat: 'Sector', terms: ['shipbuild', 'marine', 'vessel', 'naval'] },
  { skill: 'Construction Management', cat: 'Sector', terms: ['construction', 'site manager', 'superintendent', 'foreman'] },
];

const norm = (s: string) => (s || '').toLowerCase();

// Return the canonical skills a job demands. We match on the job TITLE only:
// titles are concise and role-defining ("Mining Engineer", "Diesel Fitter"),
// whereas descriptions are boilerplate-heavy ("excellent communication skills")
// and badly inflate generic skills. The description arg is accepted for API
// stability but intentionally not matched.
export function skillsForText(title: string, _description?: string): string[] {
  const hay = ' ' + norm(title) + ' ';
  const out: string[] = [];
  for (const def of SKILLS) {
    if (def.terms.some((t) => hay.includes(t))) out.push(def.skill);
  }
  return out;
}

export const ALL_SKILLS: string[] = SKILLS.map((s) => s.skill);
export const SKILL_CATEGORY: Record<string, string> = Object.fromEntries(SKILLS.map((s) => [s.skill, s.cat]));
