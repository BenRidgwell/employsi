// GENERATED — do not edit by hand. Run scripts/gen-nz-occupation-supply.py.
// Source: Stats NZ 2023 Census (CEN23_WRK_011) — employed census usually
// resident population aged 15+, by ANZSCO sub-major occupation and regional
// council, 2013 / 2018 / 2023.
//
// THIS IS COARSER THAN THE AUSTRALIAN SUPPLY DATA and the difference decides
// how it may be shown. EQ08 gives 479 ANZSCO UNIT groups, so an Australian
// skill divides by the people doing that specific work. This table gives 43
// SUB-MAJOR groups, so a New Zealand skill shares its figure with every other
// skill in its group: Nursing, Medical Practice, Pharmacy, Dental, Allied
// Health and Medical Imaging are one number called "Health Professionals".
//
// So the figure is REPORTED UNDER THE GROUP NAME, never the skill name. See
// NZ_GROUP_NAME and lib/localSupply.ts, which carries the grain through to the
// label a reader sees. It is five times finer than Singapore's eight SSOC
// majors and is the finest occupation grain Stats NZ publishes at all — the
// generator header records the search that established that.
//
// THREE YEARS, NOT A SERIES. Occupation comes from the Census, so there is no
// monthly or quarterly movement to draw and no change figure worth computing
// over five-year gaps. Levels only.
//
// Figures are PERSONS, randomly rounded to base 3 by Stats NZ. null means the
// cell was not published, which is not the same as nobody employed.

export const NZ_SUPPLY_SOURCE =
  "Stats NZ 2023 Census — employed usually resident population by occupation (ANZSCO sub-major), regional council";

export const NZ_SUPPLY_YEARS: string[] = ["2013", "2018", "2023"];

export const NZ_MIN_EMPLOYED = 300;

/** ANZSCO group code → the name a reader must be shown instead of the skill. */
export const NZ_GROUP_NAME: Record<string, string> = {
  "5": "Clerical and Administrative Workers",
  "6": "Sales Workers",
  "11": "Chief Executives, General Managers and Legislators",
  "12": "Farmers and Farm Managers",
  "13": "Specialist Managers",
  "14": "Hospitality, Retail and Service Managers",
  "21": "Arts and Media Professionals",
  "22": "Business, Human Resource and Marketing Professionals",
  "23": "Design, Engineering, Science and Transport Professionals",
  "24": "Education Professionals",
  "25": "Health Professionals",
  "26": "ICT Professionals",
  "27": "Legal, Social and Welfare Professionals",
  "31": "Engineering, ICT and Science Technicians",
  "32": "Automotive and Engineering Trades Workers",
  "33": "Construction Trades Workers",
  "34": "Electrotechnology and Telecommunications Trades Workers",
  "35": "Food Trades Workers",
  "42": "Carers and Aides",
  "43": "Hospitality Workers",
  "44": "Protective Service Workers",
  "45": "Sports and Personal Service Workers",
  "55": "Numerical Clerks",
  "61": "Sales Representatives and Agents",
  "71": "Machine and Stationary Plant Operators",
  "73": "Road and Rail Drivers",
  "74": "Storepersons",
  "81": "Cleaners and Laundry Workers",
  "82": "Construction and Mining Labourers",
  "83": "Factory Process Workers",
};

/** ANZSCO group code → city → employed persons per census year. */
export const NZ_GROUP_EMPLOYMENT: Record<string, Record<string, (number | null)[]>> = {
  "5": {
    auckland: [80613, 96174, 98412],
    wellington: [30282, 33447, 33819],
    national: [227991, 266082, 282522],
  },
  "6": {
    auckland: [63345, 82635, 71931],
    wellington: [19863, 23775, 20457],
    national: [176817, 224376, 203499],
  },
  "11": {
    auckland: [28662, 36006, 31650],
    wellington: [8871, 10188, 8985],
    national: [71565, 90015, 80520],
  },
  "12": {
    auckland: [2838, 2796, 3384],
    wellington: [1662, 1836, 2031],
    national: [58377, 66240, 66597],
  },
  "13": {
    auckland: [61953, 84339, 97062],
    wellington: [20922, 26355, 31695],
    national: [156036, 207342, 252681],
  },
  "14": {
    auckland: [22851, 26124, 26055],
    wellington: [7809, 8337, 8274],
    national: [70098, 77487, 79722],
  },
  "21": {
    auckland: [7758, 8142, 10107],
    wellington: [3147, 3435, 3870],
    national: [17685, 18843, 24513],
  },
  "22": {
    auckland: [40317, 53292, 69393],
    wellington: [19653, 25677, 35031],
    national: [94614, 123153, 177804],
  },
  "23": {
    auckland: [21069, 33561, 42156],
    wellington: [6786, 10098, 12462],
    national: [59157, 91620, 117570],
  },
  "24": {
    auckland: [32715, 41031, 43797],
    wellington: [11760, 13881, 14397],
    national: [100113, 122052, 134001],
  },
  "25": {
    auckland: [24060, 31743, 37644],
    wellington: [8436, 10788, 12447],
    national: [74469, 96318, 116364],
  },
  "26": {
    auckland: [17421, 27147, 33678],
    wellington: [10734, 14808, 17256],
    national: [40017, 58599, 76629],
  },
  "27": {
    auckland: [14382, 18471, 20169],
    wellington: [6795, 8448, 8313],
    national: [40647, 51687, 56424],
  },
  "31": {
    auckland: [11991, 15078, 18801],
    wellington: [3897, 4437, 5844],
    national: [35097, 43446, 57915],
  },
  "32": {
    auckland: [13986, 16755, 15633],
    wellington: [3105, 3417, 3426],
    national: [48393, 57579, 55071],
  },
  "33": {
    auckland: [10842, 18033, 21324],
    wellington: [4752, 6390, 7386],
    national: [41895, 60627, 68451],
  },
  "34": {
    auckland: [7068, 10113, 11385],
    wellington: [2334, 3087, 3342],
    national: [22200, 30777, 35976],
  },
  "35": {
    auckland: [9987, 14751, 12684],
    wellington: [3510, 4518, 3936],
    national: [30402, 41994, 37989],
  },
  "42": {
    auckland: [16656, 22623, 23595],
    wellington: [6726, 7956, 7707],
    national: [62010, 77823, 79638],
  },
  "43": {
    auckland: [12249, 19119, 16368],
    wellington: [4524, 6327, 5787],
    national: [36189, 54126, 48525],
  },
  "44": {
    auckland: [8067, 10515, 10785],
    wellington: [3480, 4308, 4029],
    national: [25815, 32604, 32793],
  },
  "45": {
    auckland: [10713, 14865, 13329],
    wellington: [3480, 4428, 4338],
    national: [28788, 39318, 38076],
  },
  "55": {
    auckland: [15102, 17358, 16098],
    wellington: [5214, 5325, 4614],
    national: [37470, 40773, 39471],
  },
  "61": {
    auckland: [24480, 32034, 27444],
    wellington: [6630, 8094, 6930],
    national: [57852, 74490, 67746],
  },
  "71": {
    auckland: [9093, 12138, 14742],
    wellington: [1869, 2127, 3045],
    national: [27639, 33387, 44559],
  },
  "73": {
    auckland: [11232, 18150, 18579],
    wellington: [3981, 5430, 5235],
    national: [40953, 61581, 59628],
  },
  "74": {
    auckland: [8181, 13239, 13191],
    wellington: [1251, 1509, 1416],
    national: [17814, 26610, 26790],
  },
  "81": {
    auckland: [10548, 14100, 11841],
    wellington: [4230, 5355, 4335],
    national: [40476, 52860, 43170],
  },
  "82": {
    auckland: [4539, 7332, 7623],
    wellington: [1482, 2193, 2043],
    national: [17772, 24213, 22488],
  },
  "83": {
    auckland: [9594, 13299, 11370],
    wellington: [1902, 2415, 2064],
    national: [39579, 52698, 41523],
  },
};

/** Skill → the ANZSCO group whose employment stands in for it. */
export const NZ_SKILL_GROUP: Record<string, string> = {
  "Administration & Office Support": "5",
  "Aged & Disability Care": "42",
  "Agriculture & Farming": "12",
  "Allied Health": "25",
  "Architecture & Planning": "23",
  "Automation & Robotics": "23",
  "Automotive Trade": "32",
  "Banking & Lending": "22",
  "Bookkeeping & Payroll": "55",
  "Bricklaying & Concreting": "33",
  "Business Analysis": "22",
  "Carpentry & Joinery": "33",
  "Childcare & Early Learning": "42",
  "Civil Engineering": "23",
  "Cleaning & Facilities": "81",
  "Cloud & DevOps": "26",
  "Commercial & Legal": "27",
  "Community & Native Title": "27",
  "Construction Labouring": "82",
  "Construction Management": "13",
  "Corrections & Justice": "44",
  "Creative & Performing Arts": "21",
  Cybersecurity: "26",
  "Data Analytics": "22",
  "Data Engineering": "26",
  "Data Science & Machine Learning": "26",
  Decarbonisation: "23",
  Dental: "25",
  Design: "23",
  "Drill & Blast": "82",
  "Drilling & Wells": "23",
  "Driving & Transport": "73",
  "Education Leadership": "13",
  "Education Support": "42",
  "Electrical Engineering": "23",
  "Electrical Trade": "34",
  "Electronics & Telecoms Trade": "34",
  "Emergency & Public Safety": "44",
  Environmental: "23",
  "Finance & Accounting": "22",
  "Fixed Plant Maintenance": "32",
  "Food Trades": "35",
  "General Management": "11",
  Geology: "23",
  Geotechnical: "23",
  "HSE / Safety": "25",
  "HVAC & Refrigeration": "34",
  "Heavy Diesel Maintenance": "32",
  "Hospitality & Food Service": "43",
  "Human Resources": "22",
  "Hydrogen & Renewables": "23",
  "IT & Systems": "26",
  "Instrumentation & Control": "23",
  "Insurance & Actuarial": "22",
  "Journalism & Media": "21",
  "LNG Operations": "71",
  "Leadership & Coordination": "13",
  "Library & Information": "22",
  "Manufacturing & Production": "83",
  "Marketing & Comms": "22",
  "Mechanical Engineering": "23",
  "Mechanical Fitting": "32",
  "Medical Imaging & Pathology": "25",
  "Medical Practice": "25",
  "Mental Health & Counselling": "27",
  Metallurgy: "23",
  "Mining Engineering": "23",
  Nursing: "25",
  Operations: "13",
  "Painting & Plastering": "33",
  "Personal Services & Beauty": "45",
  Pharmacy: "25",
  "Pipeline Engineering": "23",
  "Plant & Equipment Operation": "71",
  Plumbing: "33",
  "Policy & Programs": "22",
  "Process Engineering": "23",
  "Procurement & Supply": "13",
  "Product Management": "13",
  "Project Management": "13",
  "Quality Assurance": "31",
  "Radiation Safety": "23",
  "Real Estate & Property": "61",
  "Retail & Customer Service": "6",
  "Retail Operations": "14",
  "Rigging & Scaffolding": "82",
  "Risk & Compliance": "22",
  "Sales & Business Dev": "22",
  "Science & Laboratory": "23",
  "Shipbuilding & Marine": "23",
  "Social & Community Services": "27",
  "Software Engineering": "26",
  "Sport & Recreation": "45",
  Strategy: "22",
  "Subsea Engineering": "23",
  Surveying: "23",
  "Teaching & Education": "24",
  Telecommunications: "26",
  "Underground Mining": "82",
  "Warehousing & Logistics": "74",
  "Welding & Fabrication": "32",
};
