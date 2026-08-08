// GENERATED — do not edit by hand.
// Run: python scripts/gen-linkedin-logos.py
//
// Roster id -> the company's LinkedIn avatar, for companies whose LinkedIn slug
// has been confirmed by scripts/linkedin-posts-to-d1.py (the `company_slugs`
// table). companyLogo.ts reads this ahead of the favicon service and behind
// everything chosen deliberately.
//
// These are 200x200 squares, which is what the round map pin needs — the
// favicon service returns whatever a site puts in <link rel=icon>, often 16px
// and often a wide wordmark that crops to an illegible slice. The URLs are
// signed but carry e=2147483647, the 32-bit maximum, so they expire in 2038.
//
// Every entry decoded, was at least 128px on the short side, and had ink in it
// when it was written. Regenerating MERGES: a run LinkedIn throttles adds
// nothing rather than deleting what earlier runs found.
export const LINKEDIN_LOGO: Record<string, string> = {
  bhp: "https://media.licdn.com/dms/image/v2/C4D0BAQELDYAj2D7aWw/company-logo_200_200/company-logo_200_200/0/1631313788325?e=2147483647&v=beta&t=zf-HklhmR9C3l2dIXEAOWxDY3RC9c8l6vXYm4VOK2DU",
  fmg: "https://media.licdn.com/dms/image/v2/D560BAQEHCNp6AXpewg/company-logo_200_200/company-logo_200_200/0/1695717090491/fortescue_logo?e=2147483647&v=beta&t=1zqx7OYYy2G5koBLWI3mVylVtSGPIYiE0RGRDAiQ7y0",
  gor: "https://media.licdn.com/dms/image/v2/C4E0BAQFK9XqyHEa8bw/company-logo_200_200/company-logo_200_200/0/1630603706983/gold_road_resources_logo?e=2147483647&v=beta&t=RFUOCwPRgynNfr53t2VWF0XPKYC9NGlvWfcOFRZIXEA",
  ilu: "https://media.licdn.com/dms/image/v2/C510BAQGqevd7zX96nw/company-logo_200_200/company-logo_200_200/0/1630602746495/iluka_resources_logo?e=2147483647&v=beta&t=Gd8DPcte1K0_gQfw9sQQVDDMcq0WU2dE61UDeuH0ymw",
  jms: "https://media.licdn.com/dms/image/v2/D560BAQFbDAznatuaTw/company-logo_200_200/company-logo_200_200/0/1731306323538/jupitermines_logo?e=2147483647&v=beta&t=NNm37dwSNktjSQB5t_ZRIP37zMumr_eCq15phWCRQe4",
  mah: "https://media.licdn.com/dms/image/v2/D560BAQF6he3PVnOU-g/company-logo_200_200/company-logo_200_200/0/1684822925507/macmahon_logo?e=2147483647&v=beta&t=LsTQeOXHIEYrMJ-ztXOk114MZOXh6ctP7EyxEOZjRJ0",
  min: "https://media.licdn.com/dms/image/v2/D4E0BAQE_yUw4ASAvJQ/company-logo_200_200/B4EZ5oKCQqG0AE-/0/1779863923127/mineral_resources_limited_logo?e=2147483647&v=beta&t=XZAn7twUFxQQlLIAcFpC_InUi3QEs_aNogcTyDq_XwY",
  "perth-drr":
    "https://media.licdn.com/dms/image/v2/C560BAQECfmEH7ABVTA/company-logo_200_200/company-logo_200_200/0/1630646589607?e=2147483647&v=beta&t=48a41IT_-Y73IcXupABed7Pn7a3Eke_wA3iJiaqk6Xw",
  "perth-obm":
    "https://media.licdn.com/dms/image/v2/C560BAQHUC0d_8Pfl3A/company-logo_200_200/company-logo_200_200/0/1630631060275?e=2147483647&v=beta&t=NbyNOzwnE1z_FuSQGgOdMWYQgFr-i0RgqJnCt0t2QH4",
  "perth-rsg":
    "https://media.licdn.com/dms/image/v2/C560BAQHCMLYhkWrfzg/company-logo_200_200/company-logo_200_200/0/1649148691263/resolute_mining_logo?e=2147483647&v=beta&t=1uc2ZLQsNFB2JTAGBZJ6OI2UwIIBioVgubqwoDH6jZk",
  "priv-perth-airport":
    "https://media.licdn.com/dms/image/v2/C560BAQGoeG7rrw2SyA/company-logo_200_200/company-logo_200_200/0/1630593639470/perth_airport_logo?e=2147483647&v=beta&t=DOGkAUYGLAVtyp8gUI5EJ_uYRvowBCp67huQovKPCsY",
  pru: "https://media.licdn.com/dms/image/v2/C560BAQETXpOVqK2HUQ/company-logo_200_200/company-logo_200_200/0/1634018066590/perseus_mining_limited_logo?e=2147483647&v=beta&t=009UGjiTiIiQC6Fl6sqD6RO61TpDXwl6l0YMcbz9Yyk",
  rrl: "https://media.licdn.com/dms/image/v2/C560BAQFQwQ-Htxx4lA/company-logo_200_200/company-logo_200_200/0/1630655518667/regis_resources_logo?e=2147483647&v=beta&t=QVe44dez4lC7qQFpf-ZTKKhnS82cGDW8UTC5zoD1czQ",
  "sydney-wor":
    "https://media.licdn.com/dms/image/v2/D560BAQHfoyQ1BKjqmQ/company-logo_200_200/company-logo_200_200/0/1701033439470/worley_logo?e=2147483647&v=beta&t=bUCfhClAJMLFAazxfza2rgkztGWpBZRbo6jLvajIXT4",
};
