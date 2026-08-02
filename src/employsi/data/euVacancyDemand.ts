// GENERATED — do not edit by hand. Run scripts/gen-eu-vacancy-demand.py.
// Source: Eurostat — Job vacancy statistics by occupation and NUTS 1 region
// (OJA breakdowns), annual experimental statistics [jvs_a_isco3_r1],
// indicator JOBVAC (job vacancies), unit THS. Each ISCO-08 3-digit occupation
// is term-matched to canonical skills via the shared skillsTaxonomy terms and
// summed per skill, BY COUNTRY (EU/euro-area aggregates and NUTS-1 sub-regions
// dropped, along with the release's custom ICT aggregate whose members are
// already itemised).
//
// THESE ARE PUBLISHED VACANCY COUNTS. Nothing is derived.
// The previous wiring read the release's EMPLOYMENT indicator and converted it
// with each country's economy-wide job vacancy rate r, as employment × r/(1−r).
// That inversion was correct arithmetic on a wrong premise: the rate is
// published for NACE B-S, all industries, so applying it to an occupation
// assumed every occupation in a country was equally short-staffed. The rate is
// gone from this file entirely.
//
// Coverage is 18 member states, which is what it has always been in practice —
// the other eight countries below appear on the map but publish no occupation
// breakdown, so they light nothing when a skill is searched.
//
// Annual figures are held flat across their calendar year and the latest year is
// carried forward to "now"; months before the first year are zero.

import { IVI_MONTHS } from './iviSkillDemand';

export const EU_YEARS: number[] = [2019, 2020, 2021, 2022, 2023, 2024];
export const EU_SOURCE =
  'Eurostat — job vacancies by occupation (jvs_a_isco3_r1, annual experimental)';

// Country id → display label and capital [lng, lat] (the marker + heat location).
export const EU_CITY_LABEL: Record<string, string> = {
  belgium: "Belgium",
  bulgaria: "Bulgaria",
  czechia: "Czechia",
  germany: "Germany",
  estonia: "Estonia",
  ireland: "Ireland",
  greece: "Greece",
  spain: "Spain",
  france: "France",
  croatia: "Croatia",
  italy: "Italy",
  cyprus: "Cyprus",
  latvia: "Latvia",
  lithuania: "Lithuania",
  luxembourg: "Luxembourg",
  hungary: "Hungary",
  malta: "Malta",
  netherlands: "Netherlands",
  austria: "Austria",
  poland: "Poland",
  portugal: "Portugal",
  romania: "Romania",
  slovenia: "Slovenia",
  slovakia: "Slovakia",
  finland: "Finland",
  sweden: "Sweden",
};
export const EU_CITY_LNGLAT: Record<string, [number, number]> = {
  belgium: [4.35, 50.85],
  bulgaria: [23.32, 42.7],
  czechia: [14.42, 50.08],
  germany: [13.4, 52.52],
  estonia: [24.75, 59.44],
  ireland: [-6.26, 53.35],
  greece: [23.73, 37.98],
  spain: [-3.7, 40.42],
  france: [2.35, 48.86],
  croatia: [15.98, 45.81],
  italy: [12.5, 41.9],
  cyprus: [33.36, 35.17],
  latvia: [24.11, 56.95],
  lithuania: [25.28, 54.69],
  luxembourg: [6.13, 49.61],
  hungary: [19.04, 47.5],
  malta: [14.51, 35.9],
  netherlands: [4.9, 52.37],
  austria: [16.37, 48.21],
  poland: [21.01, 52.23],
  portugal: [-9.14, 38.72],
  romania: [26.1, 44.43],
  slovenia: [14.51, 46.06],
  slovakia: [17.11, 48.15],
  finland: [24.94, 60.17],
  sweden: [18.07, 59.33],
};
export const EU_CITIES: string[] = ["belgium", "bulgaria", "czechia", "germany", "estonia", "ireland", "greece", "spain", "france", "croatia", "italy", "cyprus", "latvia", "lithuania", "luxembourg", "hungary", "malta", "netherlands", "austria", "poland", "portugal", "romania", "slovenia", "slovakia", "finland", "sweden"];

// Compact source values: skill → country id → [VACANCIES per EU_YEARS].
// A country absent from a skill publishes no vacancies for any occupation that
// maps to it — which is not the same as publishing a zero.
const EU_VACANCIES: Record<string, Record<string, number[]>> = {
  "Administration & Office Support": { belgium: [11180,9550,14480,18240,15860,13850], bulgaria: [950,750,850,910,850,890], czechia: [11110,8560,9390,9210,6010,5090], germany: [92080,74740,86110,116650,112600,89210], spain: [5040,3800,5090,5740,5570,5890], france: [24200,0,30030,43100,38360,30240], cyprus: [380,490,500,680,800,960], latvia: [2200,1150,1630,2440,2560,3080], lithuania: [1150,910,1370,1370,1520,1600], hungary: [4770,3320,4770,6070,5250,5010], netherlands: [21150,15680,27580,39360,34650,28680], austria: [7340,5930,9170,14010,12610,11990], portugal: [1230,750,1290,1990,1940,1960], romania: [9050,7310,8870,10830,9850,9490], slovenia: [900,680,1120,1530,1270,1280], slovakia: [920,630,880,1060,970,1020], finland: [1640,1440,1890,2110,1390,850], sweden: [4370,3100,3990,5590,4830,3570] },
  "Marketing & Comms": { belgium: [10330,9270,15050,16420,13850,10210], bulgaria: [1330,1050,1270,1630,1430,970], czechia: [12230,10530,11430,13550,7810,6620], germany: [91780,70520,97080,145670,126830,94000], spain: [7310,6580,8610,10240,10440,9650], france: [25340,0,35020,50750,42190,29760], cyprus: [710,760,1000,1360,1670,1700], latvia: [3580,3020,2670,2770,2510,2270], lithuania: [2230,1870,2710,2750,3180,3080], hungary: [6410,6310,7440,10080,8210,7430], netherlands: [14130,10990,20090,26700,21860,13760], austria: [10030,8980,12660,20510,17860,13570], portugal: [2690,1940,3490,5090,4650,3640], romania: [2650,1630,1930,1390,990,720], slovenia: [460,370,610,670,620,600], slovakia: [2010,1510,1690,2080,1890,2120], finland: [2810,2150,2920,3750,2440,2400], sweden: [6730,4940,7360,9620,8090,6030] },
  "Software Engineering": { belgium: [8880,8000,11770,11710,10280,7160], bulgaria: [1230,950,1260,1430,1020,600], czechia: [10730,7980,9230,13110,8740,6900], germany: [98350,74210,94160,149700,120800,94100], spain: [8380,7630,9690,11390,9750,7250], france: [14160,0,23280,31080,24590,16760], cyprus: [510,580,610,820,830,790], latvia: [1600,1110,1090,910,660,590], lithuania: [1790,1360,1630,1540,1820,1970], hungary: [5210,2850,4530,4960,3910,2760], netherlands: [21510,18420,26230,31470,30170,21890], austria: [12040,11430,13360,20730,19350,14200], portugal: [3380,2970,4000,5610,4300,3720], romania: [4180,2740,2770,1860,1440,930], slovenia: [280,270,410,420,340,300], slovakia: [1330,810,970,1130,1050,1180], finland: [1810,1430,1890,2420,1310,1270], sweden: [6550,5070,7460,9050,7340,5840] },
  "Science & Laboratory": { belgium: [4760,4230,5510,5890,5680,5420], bulgaria: [850,740,790,790,770,690], czechia: [15370,12990,14300,15060,9720,8970], germany: [62880,48170,58270,64850,67740,54490], spain: [2310,2040,2760,3460,3550,3610], france: [20240,0,22130,28770,28830,27050], cyprus: [70,70,120,170,290,310], latvia: [330,290,360,350,320,280], lithuania: [350,340,540,530,590,600], hungary: [1380,880,1300,1600,1570,1290], netherlands: [8050,6160,6440,9290,10190,10820], austria: [14290,10720,14610,9220,8770,8070], portugal: [720,460,750,940,980,970], romania: [520,310,410,280,250,220], slovenia: [280,240,390,420,340,380], slovakia: [650,450,510,680,690,790], finland: [1390,1210,1840,2080,1650,1400], sweden: [2870,2290,3180,4500,4230,3640] },
  "Plant & Equipment Operation": { belgium: [4620,4410,5570,7620,7160,8280], bulgaria: [300,240,250,240,240,100], czechia: [8340,7180,5680,3820,3410,3220], germany: [36350,26730,39110,49370,48560,38160], spain: [4480,3680,5390,6270,7280,8460], france: [9240,0,10600,13490,14510,13340], cyprus: [0,0,0,0,80,90], latvia: [370,260,490,400,310,190], lithuania: [310,340,820,700,550,560], hungary: [1750,1140,1520,1450,1200,1020], netherlands: [17020,10950,18410,27470,24640,34750], austria: [2720,1840,3170,3630,3150,2530], portugal: [540,330,610,630,600,710], romania: [810,680,680,890,950,820], slovenia: [410,350,590,650,550,460], slovakia: [1100,970,1080,1270,1230,1360], finland: [1180,920,1430,1370,1210,850], sweden: [1260,850,1500,2080,1940,1770] },
  "Hospitality & Food Service": { belgium: [3130,2740,4280,4930,4170,3800], bulgaria: [1320,1240,1310,1010,800,790], czechia: [16710,11710,11130,12590,11380,10650], germany: [29610,16190,24430,33490,34430,25300], spain: [5620,2610,4570,7490,11380,12860], france: [12860,0,14350,22310,19050,16910], cyprus: [390,130,300,500,490,490], latvia: [1150,520,900,1210,1110,1160], lithuania: [500,450,770,960,750,650], hungary: [3230,2180,2770,3330,2430,2410], netherlands: [5990,3570,6390,9180,7380,7290], austria: [6410,3690,7260,11780,7090,5140], portugal: [1990,690,1420,3510,3260,3630], romania: [2160,1210,1570,2020,2140,2140], slovenia: [2040,1060,1690,1830,1740,1200], slovakia: [1270,920,920,940,1180,1410], finland: [3590,2040,3070,5030,3890,2520], sweden: [6670,3920,5360,6980,6130,5520] },
  "Manufacturing & Production": { belgium: [4640,4720,6190,7170,7260,7290], bulgaria: [150,70,90,80,100,120], czechia: [12590,12680,10120,8540,7810,7200], germany: [27530,19420,24670,26890,27100,21540], spain: [4230,3410,5060,5830,6750,7710], france: [6400,0,8630,10400,11250,9850], cyprus: [60,0,50,0,50,70], latvia: [260,150,330,250,160,150], lithuania: [280,320,450,470,420,450], hungary: [960,380,580,350,280,210], netherlands: [17780,13310,23200,31830,30680,37690], austria: [1580,1070,1650,1530,1490,1090], portugal: [280,170,360,370,360,490], romania: [970,670,710,760,810,690], slovenia: [490,400,710,870,760,690], slovakia: [1190,1120,1160,1290,1320,1430], finland: [440,360,560,570,420,300], sweden: [780,450,680,660,640,590] },
  "Cleaning & Facilities": { belgium: [3020,2790,3530,4260,4410,4660], bulgaria: [220,190,200,250,210,300], czechia: [8590,6910,4610,4130,4370,4310], germany: [28930,21290,29480,33610,36100,31770], spain: [2960,2240,2770,3270,4260,5060], france: [11270,0,13170,18270,18250,19610], cyprus: [60,0,80,120,170,230], latvia: [770,370,730,930,910,980], lithuania: [200,240,370,570,560,660], hungary: [1660,1460,1220,1690,1310,1160], netherlands: [5870,4040,6600,8240,8310,9810], austria: [3030,2110,3800,5700,4370,3010], portugal: [860,460,550,1120,1130,1280], romania: [1490,1110,1170,1580,1510,1490], slovenia: [690,500,480,890,970,720], slovakia: [250,110,110,110,160,170], finland: [1860,1490,2420,3150,2270,1520], sweden: [1150,770,970,1400,1420,1490] },
  "Teaching & Education": { belgium: [1750,1420,2180,2280,2060,2260], bulgaria: [440,360,410,450,400,470], czechia: [4320,3070,1440,2490,2580,2480], germany: [26340,23760,29050,41330,41050,33000], spain: [2170,1650,1700,6290,3930,2240], france: [13160,0,8120,8300,9940,12670], cyprus: [0,0,0,50,40,50], latvia: [280,310,430,530,630,510], lithuania: [90,110,180,170,80,70], hungary: [760,480,230,300,410,230], netherlands: [3640,2300,2350,3110,3400,3540], austria: [2780,2460,3360,5330,5290,4790], portugal: [380,230,330,540,550,600], romania: [770,630,530,540,440,340], slovenia: [210,160,450,550,560,380], slovakia: [370,410,490,610,760,880], finland: [1860,2910,2610,1910,2680,2370], sweden: [7830,5910,7520,10210,8440,8570] },
  "Driving & Transport": { belgium: [3300,3000,3740,4740,5220,5800], bulgaria: [540,750,830,530,500,550], czechia: [12530,12470,12590,8460,7270,7500], germany: [16740,12800,14850,20840,22440,18960], spain: [2570,1980,2710,3650,4490,4870], france: [10350,0,10640,15340,14160,10900], cyprus: [0,0,0,0,50,80], latvia: [570,300,570,660,650,750], lithuania: [90,130,220,230,260,270], hungary: [2470,1910,2200,2680,2410,2280], netherlands: [6790,4480,6280,8850,10740,13140], austria: [1230,940,1960,1870,1460,1360], portugal: [950,520,630,1150,1380,1520], romania: [3190,2450,3450,4320,3970,3730], slovenia: [320,200,400,460,330,290], slovakia: [390,260,300,310,350,390], finland: [560,260,440,450,500,570], sweden: [1290,810,1050,1550,1790,1770] },
  "Aged & Disability Care": { belgium: [1710,1520,1950,2150,2220,2260], bulgaria: [170,150,160,240,190,210], czechia: [1540,760,480,600,540,560], germany: [39960,34280,37400,43570,42920,30130], spain: [1330,1760,1720,1570,2120,2200], france: [14330,0,11050,12540,15030,15520], latvia: [120,140,210,210,260,240], lithuania: [50,40,50,70,70,70], hungary: [490,500,210,360,260,290], netherlands: [4080,3450,3090,4520,4490,4490], austria: [1470,1250,1720,2250,2090,1650], portugal: [300,350,380,740,670,830], romania: [1310,1150,1170,1260,960,820], slovenia: [340,280,370,460,490,360], slovakia: [140,130,110,110,150,180], finland: [2670,3110,3500,3390,4510,4610], sweden: [8770,6510,8190,11330,9890,9120] },
  "Leadership & Coordination": { belgium: [3050,2470,3020,3220,3150,3370], bulgaria: [210,150,220,260,280,270], czechia: [7240,5700,5720,6190,4050,3620], germany: [21140,16920,20740,27370,26640,20980], spain: [2580,2010,2940,3900,4140,4530], france: [10050,0,12500,17230,16370,15330], cyprus: [60,0,0,190,440,440], latvia: [450,320,380,430,430,430], lithuania: [730,610,860,850,930,1060], hungary: [1120,740,1140,1390,1170,1120], netherlands: [5390,4560,7710,8630,7910,8910], austria: [2180,1800,2040,3350,3000,2730], portugal: [430,270,420,640,640,700], romania: [680,450,490,440,330,280], slovenia: [70,80,160,140,200,150], slovakia: [830,660,690,860,800,910], finland: [1380,1080,1640,1930,1470,820], sweden: [840,530,650,930,900,810] },
  "Finance & Accounting": { belgium: [2960,2620,4120,4260,4220,3030], bulgaria: [260,190,220,350,350,230], czechia: [7500,6740,6570,7700,4560,3830], germany: [20800,17730,21120,28370,26260,22930], spain: [1500,1320,1690,2250,2380,2340], france: [5060,0,7540,10970,9200,7940], cyprus: [220,260,270,340,470,550], latvia: [680,450,430,420,450,440], lithuania: [490,360,520,540,810,830], hungary: [2510,1410,2160,2140,2170,1780], netherlands: [2780,2150,3650,4340,3890,2850], austria: [1810,1610,1970,3110,3080,2910], portugal: [500,370,570,830,870,750], romania: [790,460,530,370,280,270], slovenia: [130,100,160,220,200,170], slovakia: [410,220,240,300,280,250], finland: [460,340,540,650,420,330], sweden: [1120,890,1140,1540,1330,980] },
  "Commercial & Legal": { belgium: [1650,1330,2150,2640,2190,1750], bulgaria: [180,150,200,270,200,190], czechia: [1580,1000,830,1080,690,660], germany: [17800,14350,16700,20160,18200,18900], spain: [770,770,1040,1340,1760,1880], france: [4740,0,6370,9280,8670,7500], cyprus: [140,130,160,180,250,260], latvia: [440,360,350,360,380,340], lithuania: [480,530,700,760,780,790], hungary: [660,400,610,750,550,520], netherlands: [3080,2370,3240,4760,4370,4560], austria: [1120,1020,1440,2050,2020,1790], portugal: [240,170,300,490,370,430], romania: [420,250,360,320,230,170], slovenia: [60,60,90,200,170,150], slovakia: [180,130,130,170,160,190], finland: [580,680,770,910,900,570], sweden: [3860,3150,3830,5370,5380,4710] },
  "Mechanical Fitting": { belgium: [1400,950,1030,1380,2000,2680], bulgaria: [90,70,60,80,90,100], czechia: [7180,5420,5690,4400,4290,3820], germany: [18910,13040,16270,19760,21600,16510], spain: [950,740,1070,1190,1260,1310], france: [5010,0,4850,6950,7160,6560], cyprus: [0,0,0,0,60,70], latvia: [230,150,260,250,220,180], lithuania: [140,160,200,200,160,210], hungary: [1610,1350,1500,1750,1870,1450], netherlands: [3950,2660,3230,3770,5640,7320], austria: [1670,830,1230,1630,1520,1360], portugal: [460,310,440,510,570,700], romania: [540,440,370,440,480,450], slovenia: [290,300,450,470,380,320], slovakia: [290,220,290,290,330,370], finland: [480,360,630,770,630,330], sweden: [860,460,820,1010,1140,1230] },
  "Data Engineering": { belgium: [960,960,1540,1390,1290,850], bulgaria: [220,160,200,230,210,120], czechia: [1620,1280,1640,2220,1140,860], germany: [19620,18850,43640,36320,23810,20060], spain: [850,1050,1170,1310,1160,870], france: [2400,0,4340,5150,4230,2680], cyprus: [80,100,120,130,160,170], latvia: [420,300,290,290,240,220], lithuania: [190,160,220,180,280,320], hungary: [1080,680,980,1030,800,680], netherlands: [3760,3170,4210,5580,5210,2800], austria: [1860,1910,2480,3900,3990,2890], portugal: [430,420,600,730,710,680], romania: [570,430,300,200,240,160], slovenia: [0,0,0,0,40,40], slovakia: [250,180,200,270,230,250], finland: [350,340,370,460,320,240], sweden: [620,500,710,900,830,740] },
  "Welding & Fabrication": { belgium: [1030,680,710,980,1200,1940], bulgaria: [200,180,170,160,150,210], czechia: [4120,3520,3120,1910,1920,1740], germany: [18780,12030,14250,18390,19250,14330], spain: [1350,930,1230,1280,1340,1450], france: [4530,0,4230,5420,6270,5840], cyprus: [0,0,0,0,70,80], latvia: [300,170,280,280,230,230], lithuania: [100,140,210,250,150,120], hungary: [640,560,470,540,480,370], netherlands: [2210,1300,1090,1910,2440,3310], austria: [1350,700,930,1210,1240,1190], portugal: [240,180,230,290,380,470], romania: [390,300,260,290,290,290], slovenia: [150,150,160,170,200,150], slovakia: [220,160,180,190,180,200], finland: [680,600,960,1140,830,670], sweden: [530,330,480,570,650,620] },
  "General Management": { belgium: [330,270,490,380,380,290], bulgaria: [40,30,40,50,40,40], czechia: [1220,550,460,740,630,590], germany: [14850,11080,15690,30450,23550,19270], spain: [370,390,390,410,470,390], france: [3710,0,5000,7490,6680,5660], cyprus: [0,0,0,0,60,70], latvia: [420,260,280,330,330,370], lithuania: [120,90,140,160,200,200], hungary: [210,160,220,270,230,200], netherlands: [630,510,860,1110,1150,840], austria: [1470,1350,1750,3550,2550,2430], portugal: [50,30,50,110,110,100], romania: [110,100,90,60,50,60], slovakia: [80,40,50,40,50,40], finland: [140,120,160,170,120,90], sweden: [310,260,350,480,380,310] },
  "Telecommunications": { belgium: [500,430,570,670,780,1050], bulgaria: [20,40,20,60,50,40], czechia: [650,170,0,160,180,180], germany: [17030,13590,15790,19390,21860,18000], spain: [1620,1590,2030,2800,3000,3320], france: [2230,0,1870,2300,2170,2910], cyprus: [0,0,0,50,150,190], lithuania: [200,170,290,360,320,330], hungary: [1190,1070,1050,1130,1210,1040], netherlands: [530,280,300,480,440,370], austria: [800,580,660,570,550,530], portugal: [130,70,70,130,130,180], romania: [110,60,50,50,70,80], slovenia: [190,170,230,310,290,270], slovakia: [180,150,40,50,40,60], finland: [50,0,0,0,70,50], sweden: [440,330,390,530,540,450] },
  "Childcare & Early Learning": { belgium: [750,440,640,700,750,850], bulgaria: [80,70,70,80,90,90], czechia: [810,310,240,250,240,280], germany: [10570,9380,9900,12990,14040,10990], spain: [520,480,420,220,750,610], france: [10290,0,6450,6230,7540,7900], latvia: [120,90,150,150,190,180], hungary: [360,340,80,150,150,60], netherlands: [1340,880,450,580,630,690], austria: [480,310,400,640,510,310], portugal: [60,70,80,200,210,220], romania: [590,530,420,460,380,290], slovenia: [120,100,230,280,290,220], slovakia: [60,50,60,70,90,90], finland: [610,720,610,570,870,690], sweden: [5190,3720,4870,6810,5540,5030] },
  "Nursing": { belgium: [1020,1270,1640,1960,1960,1840], bulgaria: [80,90,80,50,60,100], czechia: [1220,1000,590,900,830,860], germany: [10440,7830,8010,10190,11270,9190], spain: [420,720,680,730,950,960], france: [1690,0,1340,1620,1800,1820], cyprus: [0,0,0,0,50,90], latvia: [160,150,190,220,250,250], lithuania: [40,40,50,40,60,90], hungary: [300,400,290,270,210,250], netherlands: [2750,2600,2930,3740,3390,2890], austria: [730,580,800,1280,1310,1430], portugal: [100,390,450,550,380,590], romania: [200,150,310,450,260,130], slovenia: [410,430,380,460,530,440], slovakia: [20,0,0,0,10,10], finland: [1030,1610,1930,2130,2390,960], sweden: [2750,2890,3140,3420,3880,3760] },
  "Surveying": { belgium: [860,690,1260,1170,890,620], bulgaria: [600,550,590,510,470,510], czechia: [850,620,630,770,470,460], germany: [14140,11680,15820,18830,14790,10690], spain: [950,610,790,880,920,850], france: [1770,0,2420,2590,2020,1770], cyprus: [80,90,120,140,190,210], latvia: [280,210,250,210,180,140], lithuania: [160,140,220,200,200,210], hungary: [760,440,830,720,600,500], netherlands: [1250,930,1420,1860,1390,1090], austria: [1110,1000,1660,2050,1630,1120], portugal: [340,190,280,420,350,280], romania: [360,220,220,150,110,90], slovenia: [0,40,0,70,50,60], slovakia: [80,40,50,60,50,60], finland: [440,320,420,480,330,280], sweden: [690,570,840,1030,860,640] },
  "Architecture & Planning": { belgium: [860,690,1260,1170,890,620], bulgaria: [600,550,590,510,470,510], czechia: [850,620,630,770,470,460], germany: [14140,11680,15820,18830,14790,10690], spain: [950,610,790,880,920,850], france: [1770,0,2420,2590,2020,1770], cyprus: [80,90,120,140,190,210], latvia: [280,210,250,210,180,140], lithuania: [160,140,220,200,200,210], hungary: [760,440,830,720,600,500], netherlands: [1250,930,1420,1860,1390,1090], austria: [1110,1000,1660,2050,1630,1120], portugal: [340,190,280,420,350,280], romania: [360,220,220,150,110,90], slovenia: [0,40,0,70,50,60], slovakia: [80,40,50,60,50,60], finland: [440,320,420,480,330,280], sweden: [690,570,840,1030,860,640] },
  "Personal Services & Beauty": { belgium: [660,500,750,840,810,580], bulgaria: [250,200,140,110,100,100], czechia: [1760,1140,780,890,820,840], germany: [5640,3750,4730,4590,5070,3610], spain: [2490,1630,1810,2440,3370,3440], france: [3020,0,2820,3910,3620,4180], cyprus: [60,0,70,110,90,90], latvia: [420,240,300,340,320,310], lithuania: [100,40,90,120,130,120], hungary: [550,440,410,480,400,370], netherlands: [420,200,360,490,460,330], austria: [1310,820,1110,1630,1170,1120], portugal: [450,200,220,520,610,540], romania: [650,400,300,400,380,300], slovenia: [130,80,100,140,150,140], slovakia: [240,160,150,140,170,180], finland: [440,140,160,170,390,340], sweden: [640,380,510,600,570,520] },
  "Retail & Customer Service": { belgium: [380,400,630,850,860,770], bulgaria: [240,200,230,200,150,170], czechia: [750,760,540,330,360,280], germany: [8530,6700,5880,8000,8190,6670], spain: [320,250,410,420,510,580], france: [2230,0,3600,4960,4530,3210], cyprus: [0,0,0,80,100,120], latvia: [230,110,130,130,120,120], lithuania: [120,100,170,160,320,390], hungary: [810,680,820,830,810,840], netherlands: [460,190,640,950,700,660], austria: [590,660,580,950,900,840], portugal: [50,40,80,120,130,160], romania: [400,260,370,590,670,530], slovenia: [0,0,0,80,70,90], slovakia: [130,110,110,130,120,150], finland: [220,260,350,370,250,190], sweden: [320,260,340,420,310,260] },
  "Painting & Plastering": { belgium: [310,250,280,340,370,500], bulgaria: [40,40,30,40,30,40], czechia: [1070,1040,950,620,600,530], germany: [12900,8670,11000,10580,10280,7260], spain: [570,360,450,460,520,620], france: [2250,0,2340,2810,2940,2640], latvia: [100,60,120,130,110,110], lithuania: [0,0,30,20,30,40], hungary: [320,340,300,350,330,290], netherlands: [580,370,310,670,920,1110], austria: [620,420,480,590,460,380], portugal: [130,100,110,160,190,220], romania: [230,190,130,160,150,150], slovenia: [70,60,60,80,80,60], slovakia: [40,30,30,30,40,40], finland: [480,380,630,650,490,270], sweden: [130,80,100,120,130,160] },
  "Policy & Programs": { belgium: [610,540,530,590,800,1200], bulgaria: [50,40,40,50,50,80], czechia: [810,970,680,430,330,300], germany: [4190,3210,3530,3500,3210,2200], spain: [200,190,230,220,250,270], france: [3090,0,3810,4400,4640,3800], latvia: [70,90,130,90,70,60], lithuania: [0,40,70,40,30,40], hungary: [1420,1230,1340,1360,1340,1200], netherlands: [790,480,650,660,960,1260], austria: [600,410,510,570,440,310], portugal: [60,50,50,80,100,110], romania: [50,40,30,30,50,30], slovenia: [90,90,100,130,100,80], slovakia: [20,0,0,0,0,0], finland: [60,0,90,0,0,0], sweden: [60,50,80,80,70,60] },
  "Design": { belgium: [160,160,170,220,260,250], bulgaria: [10,0,20,30,40,70], czechia: [100,0,0,0,0,0], germany: [4150,3040,4310,4260,3920,2810], france: [20,0,0,10,10,10], lithuania: [0,40,50,60,50,50], hungary: [0,0,0,0,40,0], netherlands: [1190,820,1250,1590,1900,3370], austria: [380,310,430,290,230,210], portugal: [0,0,10,0,0,0], slovenia: [90,80,140,180,150,140], finland: [110,120,160,200,130,100], sweden: [0,0,20,20,20,30] },
  "Agriculture & Farming": { belgium: [150,130,170,170,170,260], bulgaria: [30,30,30,0,20,0], czechia: [410,170,120,130,150,150], germany: [1390,1260,1520,1640,1860,1740], spain: [190,180,210,200,270,320], france: [720,0,900,880,1020,1160], latvia: [0,0,0,0,30,0], hungary: [150,140,140,200,190,140], netherlands: [350,280,260,490,620,1320], austria: [90,90,120,180,140,120], portugal: [60,50,60,90,80,100], slovenia: [0,0,0,60,50,40], slovakia: [30,20,30,20,20,40], finland: [110,120,90,0,90,80], sweden: [600,480,620,930,830,670] },
  "Banking & Lending": { belgium: [280,190,360,450,340,220], bulgaria: [110,80,80,80,90,70], czechia: [3000,3140,3390,3320,2220,1780], germany: [4520,3600,3380,2190,2330,2080], spain: [260,220,240,60,60,70], france: [580,0,510,770,670,350], cyprus: [70,90,80,70,60,80], latvia: [120,90,60,70,50,60], lithuania: [40,40,70,70,70,90], hungary: [110,0,100,120,120,70], netherlands: [290,170,430,840,440,310], austria: [130,110,140,220,230,170], portugal: [90,20,40,60,60,50], romania: [120,80,110,130,70,80], slovakia: [100,30,30,50,60,40], finland: [160,140,190,170,170,80], sweden: [180,140,190,260,190,140] },
  "Journalism & Media": { belgium: [300,210,390,410,310,180], bulgaria: [260,190,180,340,190,130], czechia: [870,660,730,410,200,140], germany: [3650,2480,3070,3110,1860,1320], spain: [440,370,650,710,1050,1080], france: [350,0,390,580,430,380], cyprus: [50,0,0,70,70,70], latvia: [140,70,90,80,60,60], lithuania: [90,70,100,100,100,90], hungary: [470,220,330,410,330,330], netherlands: [430,260,460,690,520,340], austria: [640,300,520,460,390,210], portugal: [200,130,270,300,240,180], romania: [200,110,120,80,60,60], slovenia: [0,0,0,0,50,40], slovakia: [80,40,50,60,70,40], finland: [270,180,260,340,260,190], sweden: [280,240,340,430,290,240] },
  "Metallurgy": { belgium: [150,120,180,130,160,220], bulgaria: [70,50,50,40,40,0], czechia: [160,690,170,0,0,0], germany: [1280,960,1250,630,670,570], spain: [130,110,140,150,170,220], france: [140,0,160,190,210,190], latvia: [0,0,50,30,0,0], lithuania: [0,0,30,0,0,0], hungary: [0,0,50,0,0,0], netherlands: [340,210,280,290,410,500], austria: [200,190,350,220,210,210], portugal: [90,40,70,60,60,100], romania: [50,30,30,0,20,0], slovenia: [100,80,160,180,160,120], finland: [90,80,120,0,80,50], sweden: [210,160,370,530,520,420] },
  "Library & Information": { belgium: [80,50,60,110,60,40], czechia: [100,0,0,80,50,0], germany: [540,400,510,460,480,430], spain: [30,30,40,30,50,60], france: [190,0,120,210,240,210], latvia: [0,0,60,60,60,60], lithuania: [0,20,50,40,50,50], netherlands: [80,80,140,160,150,120], austria: [60,60,70,0,90,0], portugal: [40,20,40,20,30,0], romania: [100,60,70,60,30,0], finland: [80,80,0,0,80,60], sweden: [710,720,830,1190,980,730] },
  "Insurance & Actuarial": { belgium: [70,60,100,110,80,60], bulgaria: [50,30,40,20,0,0], germany: [770,620,730,910,890,670], spain: [140,120,100,180,380,110], france: [130,0,140,220,170,100], lithuania: [0,0,20,0,30,0], hungary: [380,240,360,420,330,280], netherlands: [60,50,90,120,100,70], austria: [80,80,60,90,110,0], portugal: [30,0,20,40,30,0], romania: [20,0,0,0,0,0], sweden: [70,60,70,90,70,70] },
};

// Month index → index into EU_YEARS: the most recent published year at or
// before that month, -1 before the first. Computed once for the axis.
const YEAR_SLOT: number[] = IVI_MONTHS.map((ym) => {
  const y = Number(ym.slice(0, 4));
  let slot = -1;
  for (let i = 0; i < EU_YEARS.length; i++) if (EU_YEARS[i] <= y) slot = i;
  return slot;
});

// Skill → country id → monthly vacancy history (aligned to IVI_MONTHS).
function expand(byCity: Record<string, number[]>): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const [city, vac] of Object.entries(byCity)) {
    out[city] = YEAR_SLOT.map((yi) => (yi < 0 ? 0 : vac[yi] || 0));
  }
  return out;
}

export const EU_SERIES: Record<string, Record<string, number[]>> =
  Object.fromEntries(Object.entries(EU_VACANCIES).map(([s, v]) => [s, expand(v)]));

// Skill → latest-month country vacancy count (current heat map).
export const EU_SKILL_BY_CITY: Record<string, Record<string, number>> =
  Object.fromEntries(
    Object.entries(EU_SERIES).map(([s, byCity]) => [
      s,
      Object.fromEntries(Object.entries(byCity).map(([c, arr]) => [c, arr[arr.length - 1]])),
    ]),
  );
