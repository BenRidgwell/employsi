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
  asb: "https://media.licdn.com/dms/image/v2/C560BAQFSQCCFh0A2cA/company-logo_200_200/company-logo_200_200/0/1631412397286/austal__logo?e=2147483647&v=beta&t=qMsoAq0IVCvmOnC343zJXycFwp921iPcM2Ne7O7nLYI",
  bhp: "https://media.licdn.com/dms/image/v2/C4D0BAQELDYAj2D7aWw/company-logo_200_200/company-logo_200_200/0/1631313788325?e=2147483647&v=beta&t=zf-HklhmR9C3l2dIXEAOWxDY3RC9c8l6vXYm4VOK2DU",
  bmn: "https://media.licdn.com/dms/image/v2/C560BAQFluhgS-3K_2w/company-logo_200_200/company-logo_200_200/0/1630655148832/bannerman_resources_limited_logo?e=2147483647&v=beta&t=d-TbCJs412BQy9wrf9XYx2jRWNtVwXneaHSFoL-LDlg",
  ccv: "https://media.licdn.com/dms/image/v2/C4D0BAQFupwbRpkKbcQ/company-logo_200_200/company-logo_200_200/0/1630520133422/domaxis_be_logo?e=2147483647&v=beta&t=T4VcBECouHmHD7oihkOnwPBihSh9moGuuyv6UemkHT4",
  chevron:
    "https://media.licdn.com/dms/image/v2/C560BAQFIzPIYfEdWdw/company-logo_200_200/company-logo_200_200/0/1630597725146/chevron_logo?e=2147483647&v=beta&t=vGrex5btdgvrkVlQ0gZH7gqOyUqFvY2EW5Ws4FsEN2U",
  cxo: "https://media.licdn.com/dms/image/v2/D560BAQHifkw7rOdW4Q/company-logo_200_200/company-logo_200_200/0/1699937708513/core_exploration_logo?e=2147483647&v=beta&t=1nB7MvIEmETVlLN7lpf_ydegz05J0KZsaUl7IIUqB1I",
  del: "https://media.licdn.com/dms/image/v2/D560BAQGUd9-XnqwP5Q/company-logo_200_200/B56ZgMK1eyHsAI-/0/1752550824301/delorean_corporation_logo?e=2147483647&v=beta&t=Zkx_fDD-BsYhzsf_cPmheYKP684j2qNxU38OjV3XEAY",
  dyl: "https://media.licdn.com/dms/image/v2/C560BAQHufFjNZm-bPw/company-logo_200_200/company-logo_200_200/0/1630599847780/deep_yellow_limited_logo?e=2147483647&v=beta&t=cnrh111xy4eo1_ZY17OnxiETg64gmTlv1MCEm9ZLO5M",
  fmg: "https://media.licdn.com/dms/image/v2/D560BAQEHCNp6AXpewg/company-logo_200_200/company-logo_200_200/0/1695717090491/fortescue_logo?e=2147483647&v=beta&t=1zqx7OYYy2G5koBLWI3mVylVtSGPIYiE0RGRDAiQ7y0",
  gmd: "https://media.licdn.com/dms/image/v2/C4D0BAQGOVAjXZ-qBZg/company-logo_200_200/company-logo_200_200/0/1657160653081/genesisminerals_logo?e=2147483647&v=beta&t=TDhBxjhK5GGXMOiikJsol6ka_XtiGY8j_HJOO1Pnv90",
  gor: "https://media.licdn.com/dms/image/v2/C4E0BAQFK9XqyHEa8bw/company-logo_200_200/company-logo_200_200/0/1630603706983/gold_road_resources_logo?e=2147483647&v=beta&t=RFUOCwPRgynNfr53t2VWF0XPKYC9NGlvWfcOFRZIXEA",
  ilu: "https://media.licdn.com/dms/image/v2/C510BAQGqevd7zX96nw/company-logo_200_200/company-logo_200_200/0/1630602746495/iluka_resources_logo?e=2147483647&v=beta&t=Gd8DPcte1K0_gQfw9sQQVDDMcq0WU2dE61UDeuH0ymw",
  jms: "https://media.licdn.com/dms/image/v2/D560BAQFbDAznatuaTw/company-logo_200_200/company-logo_200_200/0/1731306323538/jupitermines_logo?e=2147483647&v=beta&t=NNm37dwSNktjSQB5t_ZRIP37zMumr_eCq15phWCRQe4",
  ltr: "https://media.licdn.com/dms/image/v2/C560BAQGpLRMr_gz1-Q/company-logo_200_200/company-logo_200_200/0/1649132718841/liontown_resources_limited_logo?e=2147483647&v=beta&t=Q9jKrg4QvdEgWTk7PCkKblyHkne1bpp8PWiexhYq5qI",
  mah: "https://media.licdn.com/dms/image/v2/D560BAQF6he3PVnOU-g/company-logo_200_200/company-logo_200_200/0/1684822925507/macmahon_logo?e=2147483647&v=beta&t=LsTQeOXHIEYrMJ-ztXOk114MZOXh6ctP7EyxEOZjRJ0",
  "melbourne-nab":
    "https://media.licdn.com/dms/image/v2/D560BAQEpfH1XRQvlXQ/company-logo_200_200/B56Zg0mZ6gG4AM-/0/1753229140372/nab_logo?e=2147483647&v=beta&t=617bX7F-U8oiTdR7NLwRZdV8PAMPGRZ4uxGeeeWjMZ4",
  "melbourne-ori":
    "https://media.licdn.com/dms/image/v2/C4E0BAQEyR-MmWYkDcQ/company-logo_200_200/company-logo_200_200/0/1631312717785?e=2147483647&v=beta&t=ED7EUGUmEkOEa3zzZIBGMPsRqSMPu3yHNLMUNCb6KnY",
  "melbourne-tls":
    "https://media.licdn.com/dms/image/v2/D560BAQGNrMi-laFnUw/company-logo_200_200/company-logo_200_200/0/1684822727411/telstra_logo?e=2147483647&v=beta&t=l6120HmvQD9JWfSdV_4X7YsFM6CDVdWoIMwLaGTunDg",
  min: "https://media.licdn.com/dms/image/v2/D4E0BAQE_yUw4ASAvJQ/company-logo_200_200/B4EZ5oKCQqG0AE-/0/1779863923127/mineral_resources_limited_logo?e=2147483647&v=beta&t=XZAn7twUFxQQlLIAcFpC_InUi3QEs_aNogcTyDq_XwY",
  mnd: "https://media.licdn.com/dms/image/v2/C560BAQF0L7BeDMNdqA/company-logo_200_200/company-logo_200_200/0/1630580091808/monadelphous_logo?e=2147483647&v=beta&t=Qo_S90SyrpzZYYOD7TdduJwIiasDXBfbqzrtWUbaY2c",
  nst: "https://media.licdn.com/dms/image/v2/D560BAQGqYuX_NxfPvg/company-logo_200_200/company-logo_200_200/0/1734503369120/northern_star_resources_limited_logo?e=2147483647&v=beta&t=SgMSQOwXSe3sPtEiZjhd5U0LL-V3SkBHYzB0oXOhJ08",
  nwh: "https://media.licdn.com/dms/image/v2/D560BAQGUPp18FC-S1A/company-logo_200_200/B56Zp7yBVZHkAI-/0/1763013302009/nrw_holdings_logo?e=2147483647&v=beta&t=opv2ltppGozCFjWKYE7zFXSrrOLW5e3lD6j7cnWAM1w",
  pdn: "https://media.licdn.com/dms/image/v2/C560BAQHj99F7oLrY_g/company-logo_200_200/company-logo_200_200/0/1630665024580/paladin_energy_logo?e=2147483647&v=beta&t=p-jEVEhO64tm7n08F0VY1ST6F3v_y-0G90Ea4IG3w9w",
  "perth-aa":
    "https://media.licdn.com/dms/image/v2/D4E0BAQFluqrJSSanXA/company-logo_200_200/B4EZfF3IrQGcAM-/0/1751371254777/alcoa_logo?e=2147483647&v=beta&t=ShSVAMZJQJ5fMCk_NGtWD8TmcdBVqQ_DRSeFQ1fmLHY",
  "perth-bgl":
    "https://media.licdn.com/dms/image/v2/C560BAQGw1jAyD0NYKQ/company-logo_200_200/company-logo_200_200/0/1630641586945/bellevuegold_logo?e=2147483647&v=beta&t=1UxC5Ykhxkq5yP_Gra11wUq7dQUdOQy9plzyDfqKmSg",
  "perth-drr":
    "https://media.licdn.com/dms/image/v2/C560BAQECfmEH7ABVTA/company-logo_200_200/company-logo_200_200/0/1630646589607?e=2147483647&v=beta&t=48a41IT_-Y73IcXupABed7Pn7a3Eke_wA3iJiaqk6Xw",
  "perth-gov-chemcentre":
    "https://media.licdn.com/dms/image/v2/C560BAQHTvfc7LSa5NA/company-logo_200_200/company-logo_200_200/0/1631345316419?e=2147483647&v=beta&t=eNzBZGeXYiXIeNWEiVHPosld6xduOaRmH9gRk0FIEME",
  "perth-gov-child-and-adolescent-health-service":
    "https://media.licdn.com/dms/image/v2/D560BAQFzsVzC154rfQ/company-logo_200_200/company-logo_200_200/0/1687412752718/child_and_adolescent_health_service_logo?e=2147483647&v=beta&t=DUIVp-1wIG3fdTa6fZ2QCHaVDg05RWhgB9ThCbn0U5s",
  "perth-gov-construction-training-fund":
    "https://media.licdn.com/dms/image/v2/D560BAQH1r9ENBTVVnQ/company-logo_200_200/company-logo_200_200/0/1731398297781/construction_training_fund_logo?e=2147483647&v=beta&t=pe6OvpIr_t9C7yyFgWG2dYtoaGVSm0vvv1iRPo6BZv0",
  "perth-gov-department-of-biodiversity-conservation-and-attractions":
    "https://media.licdn.com/dms/image/v2/D560BAQHDD5k5tI0JHw/company-logo_200_200/company-logo_200_200/0/1687506366985/dbca_logo?e=2147483647&v=beta&t=RUXBOwsk-66IvuGaPZmOMQzvz0Vf0YHcz7M5HW04I3U",
  "perth-gov-department-of-creative-industries-tourism-and-sport":
    "https://media.licdn.com/dms/image/v2/D560BAQFtKSiYvOtxrA/company-logo_200_200/B56ZfDF1EdHQAM-/0/1751324775203/departmentoflocalgovernmentsportandculturalindustries_logo?e=2147483647&v=beta&t=DruIdvXi3H_MKt3Oxdwki2cv-QhcUUGqoIFt0c47WfI",
  "perth-gov-department-of-energy-and-economic-diversification":
    "https://media.licdn.com/dms/image/v2/C4E0BAQF0DVnayOQZHw/company-logo_200_200/company-logo_200_200/0/1630595865356?e=2147483647&v=beta&t=x1VNcNTMNbJOoTbJ5Dq1vcd_dZSJCGMIkNxTUtJY2ic",
  "perth-gov-department-of-training-and-workforce-development":
    "https://media.licdn.com/dms/image/v2/D560BAQF_sqfBrRgPKA/company-logo_200_200/company-logo_200_200/0/1690443891950/department_of_training_and_workforce_development_logo?e=2147483647&v=beta&t=nJOQjsajiQPXdpb5h7vowJJL2XL00VL0V6LbHgmgySo",
  "perth-gov-east-metropolitan-health-service":
    "https://media.licdn.com/dms/image/v2/C560BAQEfhIJK1n0Wdw/company-logo_200_200/company-logo_200_200/0/1630619316704?e=2147483647&v=beta&t=ZOB8u2Zh207NoLjNl8IWuiOn1t6LxmPjPj3EG-Ys9Vs",
  "perth-gov-economic-regulation-authority":
    "https://media.licdn.com/dms/image/v2/C560BAQHz0qz5kMI_AA/company-logo_200_200/company-logo_200_200/0/1675659087471/economic_regulation_authority_logo?e=2147483647&v=beta&t=lCWfYGEsG-qbysBLrfgpPBdf7e8cOF1YfJRCd1vWslk",
  "perth-gov-health-support-services":
    "https://media.licdn.com/dms/image/v2/C560BAQH-83kcPkhvkQ/company-logo_200_200/company-logo_200_200/0/1661732586907/healthsupportservices_logo?e=2147483647&v=beta&t=qv0IpzH0DA9brndDXlvZi_B5AE13M0qfBfU6_LnBtwc",
  "perth-gov-legal-aid-western-australia":
    "https://media.licdn.com/dms/image/v2/C560BAQFsZA52Ol5_Og/company-logo_200_200/company-logo_200_200/0/1679981680823/legal_aid_western_australia_logo?e=2147483647&v=beta&t=N_jNkcDLKK2QIzAUgo6EfFde2347hzt7GhUvGHrcDGU",
  "perth-gov-lotterywest":
    "https://media.licdn.com/dms/image/v2/D560BAQEYbMc7E6nhZA/company-logo_200_200/company-logo_200_200/0/1682063855983/lotterywest_logo?e=2147483647&v=beta&t=3xwEhzXEocsP6JfAXNbxi6ym113wNplaYV2toP9j85Q",
  "perth-gov-metropolitan-cemeteries-board":
    "https://media.licdn.com/dms/image/v2/C560BAQH2gdBfrGN1rA/company-logo_200_200/company-logo_200_200/0/1630649077698/metropolitan_cemeteries_board_logo?e=2147483647&v=beta&t=lriaCNG7tlLfsXhKe5iYE-g7Me1JA0SSR1QeZAEY8Lw",
  "perth-gov-myleave":
    "https://media.licdn.com/dms/image/v2/D560BAQGBhUPkF611cw/company-logo_200_200/company-logo_200_200/0/1684915166466/myleave_logo?e=2147483647&v=beta&t=X2WaSTDcyA1q97C57AN_t2fI0fnFTMbSx0gyJiidutQ",
  "perth-gov-north-metropolitan-health-service":
    "https://media.licdn.com/dms/image/v2/C560BAQG_fEu25BRjTQ/company-logo_200_200/company-logo_200_200/0/1630648581475/north_metropolitan_health_service_logo?e=2147483647&v=beta&t=jdUEP1gXuWfto7CLjVjaXaunxmaJruJZmJJnVXDSD00",
  "perth-gov-north-regional-tafe":
    "https://media.licdn.com/dms/image/v2/C4E0BAQFpHJSaTA74Yw/company-logo_200_200/company-logo_200_200/0/1631322103394?e=2147483647&v=beta&t=YOjDWOrHtWdRoaQrummlfPx4HrzC96z1qQ8DKNQ0B1A",
  "perth-gov-perth-zoo":
    "https://media.licdn.com/dms/image/v2/C4E0BAQEglMwCLtx9HA/company-logo_200_200/company-logo_200_200/0/1631325054611?e=2147483647&v=beta&t=RqLO2OSZqCKJUZKBP29clX3XpU3WnDrvsgu71lBUZAY",
  "perth-gov-pilbara-ports-authority":
    "https://media.licdn.com/dms/image/v2/C510BAQGC9nBUomQtBA/company-logo_200_200/company-logo_200_200/0/1631434446700/pilbara_ports_authority_logo?e=2147483647&v=beta&t=QMb5lbId8YaUcqoq4gwH6ed5A9QC2n404NL_XclLWWk",
  "perth-gov-public-sector-commission":
    "https://media.licdn.com/dms/image/v2/C560BAQHSETY71oMuFA/company-logo_200_200/company-logo_200_200/0/1636620493010/public_sector_commission_logo?e=2147483647&v=beta&t=PH4OOEPsRa3xHCneYfEOilXdWgPRpPO36NaQ66hq6GU",
  "perth-gov-public-transport-authority":
    "https://media.licdn.com/dms/image/v2/C560BAQGgedNElexLEw/company-logo_200_200/company-logo_200_200/0/1630608537795/public_transport_authority_logo?e=2147483647&v=beta&t=apPQBiyINRHLEEOrs--4Ih4eXjTyJSdNHleJKMbBGD0",
  "perth-gov-rottnest-island-authority":
    "https://media.licdn.com/dms/image/v2/C560BAQEPWLWZQ0y2HA/company-logo_200_200/company-logo_200_200/0/1678703198384/rottnest_island_authority_logo?e=2147483647&v=beta&t=7giZ7d0UV0CWS8T1ulukhw9X7Hbu9tfVxNPYcNgpGtU",
  "perth-gov-south-metropolitan-health-service":
    "https://media.licdn.com/dms/image/v2/C560BAQHA6EjDpK7kZQ/company-logo_200_200/company-logo_200_200/0/1630587342865/south_metropolitan_health_service_logo?e=2147483647&v=beta&t=bN2xQ03pw1aACV7rVKv1qngErXDOTJ-_2Da1jfEOkWY",
  "perth-gov-tourism-western-australia":
    "https://media.licdn.com/dms/image/v2/D560BAQELWoDLxhJCzw/company-logo_200_200/company-logo_200_200/0/1698024655171/tourism_western_australia_logo?e=2147483647&v=beta&t=iy7Q4bsS6-MOX015OT-WjttKni7gZQjdv4bVrrCDfEQ",
  "perth-gov-venueswest":
    "https://media.licdn.com/dms/image/v2/D560BAQGVq-2rrwnYOQ/company-logo_200_200/B56Z1MYVN9KEAI-/0/1775102940507/venueswest_logo?e=2147483647&v=beta&t=v_6KgtQw-tfRsn5GknDZpizSruMWtR_F53vUFCTXmrk",
  "perth-gov-wa-country-health-service":
    "https://media.licdn.com/dms/image/v2/C560BAQF1ws2LPeA7Zw/company-logo_200_200/company-logo_200_200/0/1631346478483?e=2147483647&v=beta&t=0q_ywXTZm8duwjc1aW9U90SGPQOnDhCNu529D1ot-K0",
  "perth-gov-western-australian-electoral-commission":
    "https://media.licdn.com/dms/image/v2/C560BAQHgtSNItDSBdg/company-logo_200_200/company-logo_200_200/0/1638261394585/western_australian_electoral_commission_logo?e=2147483647&v=beta&t=7hwsuuKZg2kHTrzkUmBa0gbJm4IHoT2Zkyz9PNGO2Sk",
  "perth-gov-western-australian-museum":
    "https://media.licdn.com/dms/image/v2/D560BAQHaNPVWiT6XHA/company-logo_200_200/company-logo_200_200/0/1701834986809/western_australian_museum_logo?e=2147483647&v=beta&t=CAGdOOA9re7UEi4Jlvgf6Slwhw-NJKKKj8dCZCaZN4g",
  "perth-gov-workcover-wa":
    "https://media.licdn.com/dms/image/v2/C560BAQHuxrVj6YC4Aw/company-logo_200_200/company-logo_200_200/0/1630995669425/workcover_wa_logo?e=2147483647&v=beta&t=EEl_57WTaz1NBoQh_4fNlBmRhtJbb1P1sCwiqyseCvY",
  "perth-imd":
    "https://media.licdn.com/dms/image/v2/C4D0BAQHMQI0LnExGXA/company-logo_200_200/company-logo_200_200/0/1655082681391/imdex_limited_logo?e=2147483647&v=beta&t=8BSNY5QX7j3H2zWyj9DCrGBpTjxFMqILfMU1N2GU_FU",
  "perth-obm":
    "https://media.licdn.com/dms/image/v2/C560BAQHUC0d_8Pfl3A/company-logo_200_200/company-logo_200_200/0/1630631060275?e=2147483647&v=beta&t=NbyNOzwnE1z_FuSQGgOdMWYQgFr-i0RgqJnCt0t2QH4",
  "perth-pdi":
    "https://media.licdn.com/dms/image/v2/D4E0BAQE_pmvgKIcgAw/company-logo_200_200/B4EZ67IZy6HAAE-/0/1781256003055/predictivediscovery_logo?e=2147483647&v=beta&t=nN7s64Qv9GtGfgR4MZrTAHxSEpEdx2IslKWJIcFvPko",
  "perth-prn":
    "https://media.licdn.com/dms/image/v2/C560BAQGeqqraERYVVQ/company-logo_200_200/company-logo_200_200/0/1630633973195/perenti_logo?e=2147483647&v=beta&t=qjBQgcwGFS9egEQ8FcPaKaZFZO3ao6Okfu7wyDyHJT8",
  "perth-rsg":
    "https://media.licdn.com/dms/image/v2/C560BAQHCMLYhkWrfzg/company-logo_200_200/company-logo_200_200/0/1649148691263/resolute_mining_logo?e=2147483647&v=beta&t=1uc2ZLQsNFB2JTAGBZJ6OI2UwIIBioVgubqwoDH6jZk",
  "perth-vau":
    "https://media.licdn.com/dms/image/v2/D560BAQEcQKALqz4Ykg/company-logo_200_200/company-logo_200_200/0/1727755442166/red_5_limited_logo?e=2147483647&v=beta&t=Kb7SwjZ9KdDFFeFII-wm_ZfpvomqIwCSPldPwvUeiRk",
  "priv-abn-group":
    "https://media.licdn.com/dms/image/v2/D560BAQHN0saAakQIhA/company-logo_200_200/company-logo_200_200/0/1720075961817/abn_group_logo?e=2147483647&v=beta&t=drsIqBekyjFOzXofzbq1BZbTut5_PaW4gTaGQXHYfF4",
  "priv-cbh-group":
    "https://media.licdn.com/dms/image/v2/C510BAQGADQyx7sxxEg/company-logo_200_200/company-logo_200_200/0/1631423552634/cbh_group_logo?e=2147483647&v=beta&t=ypegZHiCQhvxl750Jys98IY8skL1s0TiA6pxl26kcos",
  "priv-cjd-equipment":
    "https://media.licdn.com/dms/image/v2/C560BAQHnBGeKr4VbvA/company-logo_200_200/company-logo_200_200/0/1679020083538/cjdequipment_logo?e=2147483647&v=beta&t=rzP4fs2fxbeTvVyZGCaRg2Oy5Mr-7O4b-DjZNBwQmVw",
  "priv-georgiou":
    "https://media.licdn.com/dms/image/v2/D560BAQFO-jnmGJ8aYA/company-logo_200_200/B56ZiW5qraHcAQ-/0/1754878356601/georgiou_logo?e=2147483647&v=beta&t=qmOTp_hlvtr6y3DuD8eB9voUWUNQMShHCvxZ9iPcxDw",
  "priv-hancock-prospecting":
    "https://media.licdn.com/dms/image/v2/D560BAQEjA2B5RiNWWA/company-logo_200_200/B56ZhQk3H_HMAI-/0/1753698498263/hancock_prospecting_group_logo?e=2147483647&v=beta&t=KOx08bMMA4b11QHFiikadzhvG0NChdRy9jCG4s1h0NM",
  "priv-hbf":
    "https://media.licdn.com/dms/image/v2/D560BAQGlqaZx_VBiCQ/company-logo_200_200/company-logo_200_200/0/1695186068721/hbf_logo?e=2147483647&v=beta&t=JDXBT5pTrleZL6V7dGcjMx4VugC0ABMH6IZ4iksf0pU",
  "priv-john-hughes-group":
    "https://media.licdn.com/dms/image/v2/C4D0BAQECAbDjqnKjeg/company-logo_200_200/company-logo_200_200/0/1631364664832/johnhughesgroup_logo?e=2147483647&v=beta&t=hKTM-0PWMJn0at4rqxDgTg1N1lFyEkXb5LljmarP1DI",
  "priv-perron-group":
    "https://media.licdn.com/dms/image/v2/C4D0BAQE9SVsX15dmuQ/company-logo_200_200/company-logo_200_200/0/1631360984294/perron_logo?e=2147483647&v=beta&t=11Psp4qaNvP-LY4bYiBOy0VKASP3ntt0PRktha1Wu3s",
  "priv-perth-airport":
    "https://media.licdn.com/dms/image/v2/C560BAQGoeG7rrw2SyA/company-logo_200_200/company-logo_200_200/0/1630593639470/perth_airport_logo?e=2147483647&v=beta&t=DOGkAUYGLAVtyp8gUI5EJ_uYRvowBCp67huQovKPCsY",
  "priv-rac-of-wa":
    "https://media.licdn.com/dms/image/v2/C4E0BAQETHjv0Zh2jow/company-logo_200_200/company-logo_200_200/0/1663679515144/rac_logo?e=2147483647&v=beta&t=MUqEiEK3YjzdSfpRXq3oRGlV7yYRXTpAOjznaCkZT9g",
  "priv-st-john-of-god-health-care":
    "https://media.licdn.com/dms/image/v2/C4E0BAQEh63Idu1LFqg/company-logo_200_200/company-logo_200_200/0/1631348313243?e=2147483647&v=beta&t=FR8mFj0CrnV6Zox33BVAZB8gI72_3gRY8PVkpCjGnPQ",
  pru: "https://media.licdn.com/dms/image/v2/C560BAQETXpOVqK2HUQ/company-logo_200_200/company-logo_200_200/0/1634018066590/perseus_mining_limited_logo?e=2147483647&v=beta&t=009UGjiTiIiQC6Fl6sqD6RO61TpDXwl6l0YMcbz9Yyk",
  rio: "https://media.licdn.com/dms/image/v2/D560BAQFBmNPHgN7h1A/company-logo_200_200/company-logo_200_200/0/1719791037771/rio_tinto_logo?e=2147483647&v=beta&t=orF7vuvwTWf9aHClbZZUWVPtydNUCWzlpxgMUvryYQU",
  rms: "https://media.licdn.com/dms/image/v2/D560BAQGVWZ4iF233mA/company-logo_200_200/B56Zlxlah6KAAM-/0/1758547259705/ramelius_resources_limited_logo?e=2147483647&v=beta&t=dUqUPUGu_obhgW9BDgOmxUvDOQckQiwdRzoRAa9S4N8",
  rrl: "https://media.licdn.com/dms/image/v2/C560BAQFQwQ-Htxx4lA/company-logo_200_200/company-logo_200_200/0/1630655518667/regis_resources_logo?e=2147483647&v=beta&t=QVe44dez4lC7qQFpf-ZTKKhnS82cGDW8UTC5zoD1czQ",
  s32: "https://media.licdn.com/dms/image/v2/C560BAQFgInElzZc6XQ/company-logo_200_200/company-logo_200_200/0/1631589419446/south32_logo?e=2147483647&v=beta&t=XU9hkNA959hGtU7pdMZM3wqsJ5zs72AMb_dVt__jTQk",
  sfr: "https://media.licdn.com/dms/image/v2/C560BAQHMmmMViEJ2DA/company-logo_200_200/company-logo_200_200/0/1630661454896/sandfire_resources_logo?e=2147483647&v=beta&t=KOtrbCBQwvKJOjDXvZ9DSgk6AVhOSPqBozF3zI8UWuI",
  sto: "https://media.licdn.com/dms/image/v2/C4D0BAQFT2rtioUKgAg/company-logo_200_200/company-logo_200_200/0/1631331100978?e=2147483647&v=beta&t=6s-LyB2kHZXHWfCssuVdzvqUSu8bWU7YpLlNm7cC_SQ",
  stx: "https://media.licdn.com/dms/image/v2/C560BAQFd3FD5TGHd0A/company-logo_200_200/company-logo_200_200/0/1630563933576/strike_energy_logo?e=2147483647&v=beta&t=cKpdKXKckV-LUvVWqnVaaiic3yHn9p06ODHht17ItUA",
  swm: "https://media.licdn.com/dms/image/v2/C560BAQEnCGbnY4RU_w/company-logo_200_200/company-logo_200_200/0/1630650164344/sevenwestmedia_logo?e=2147483647&v=beta&t=bWyBFOvdub4v-IOYVx75KOK0N-a2FiE2swuw7ABDizs",
  "sydney-apa":
    "https://media.licdn.com/dms/image/v2/D560BAQFf8ejlb_4bKg/company-logo_200_200/company-logo_200_200/0/1724794845150/apa_group_logo?e=2147483647&v=beta&t=HLyp_5kr0KU9wP1wFkfkG2dc2lXVq8JhBB1MyKGEt8g",
  "sydney-dow":
    "https://media.licdn.com/dms/image/v2/C4E0BAQFLXI2ti1h88g/company-logo_200_200/company-logo_200_200/0/1631308092500?e=2147483647&v=beta&t=2v4HJVhuFM1QU5eddBvulG7HRjJJL3PzS04kGkpuLno",
  "sydney-mqg":
    "https://media.licdn.com/dms/image/v2/C4D0BAQFWxaMqRxHNZQ/company-logo_200_200/company-logo_200_200/0/1630472263203/macquariegroup_logo?e=2147483647&v=beta&t=0Fi5wZjXRSevd8JcvmpRhIsZs5E81BX3s0eOji18VLU",
  "sydney-wor":
    "https://media.licdn.com/dms/image/v2/D560BAQHfoyQ1BKjqmQ/company-logo_200_200/company-logo_200_200/0/1701033439470/worley_logo?e=2147483647&v=beta&t=bUCfhClAJMLFAazxfza2rgkztGWpBZRbo6jLvajIXT4",
  wds: "https://media.licdn.com/dms/image/v2/D560BAQEJkyj3JlLtnw/company-logo_200_200/B56Z6GANeiJsAE-/0/1780364662896/woodside_energy_logo?e=2147483647&v=beta&t=uJTPPsXwtGmWXa1xCisUtsBKEUWzBBbayKjp8TriSFs",
  wes: "https://media.licdn.com/dms/image/v2/C560BAQEru3hAx9DZpA/company-logo_200_200/company-logo_200_200/0/1631322279957?e=2147483647&v=beta&t=EoJqcnHfVFr1WJoO95qVe0ce8Do8C7Ik7aYVFkT3-Oc",
  wgx: "https://media.licdn.com/dms/image/v2/D560BAQElQMtQHVVtKg/company-logo_200_200/company-logo_200_200/0/1708573073823?e=2147483647&v=beta&t=Wri93a1beBSUe_1WU4XO4FVUMyA7wjFn5KsMUYnOKIo",
};
