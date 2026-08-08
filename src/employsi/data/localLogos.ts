// GENERATED — do not edit by hand.
// Run: bun run scripts/gen-local-logos.ts
//
// Roster id -> a logo file committed under public/logos/. These are checked in
// rather than linked, so unlike every other badge source they cannot stop
// resolving when somebody else's server changes. companyLogo.ts reads this
// first, which makes dropping a file in the folder the way to override a wrong
// or low-quality badge without editing any data file.
export const LOCAL_LOGO: Record<string, string> = {
  "perth-gov-north-metropolitan-health-service":
    "/logos/perth-gov-north-metropolitan-health-service.jpeg",
};
