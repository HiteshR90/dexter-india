/**
 * Portfolio CSV parser supporting Zerodha and Groww broker formats.
 * Auto-detects broker from CSV headers and normalizes to a common Holding interface.
 */

export interface Holding {
  symbol: string;
  name: string;
  quantity: number;
  avgPrice: number;
  currentPrice: number;
  currentValue: number;
  pnl: number;
  pnlPercent: number;
  dayChange: number;
  sector?: string;
}

type Broker = 'zerodha' | 'groww' | 'groww_statement';

const ZERODHA_HEADERS = ['instrument', 'qty.', 'avg. cost', 'ltp', 'cur. val', 'p&l', 'net chg.', 'day chg.'];
const GROWW_HEADERS = ['symbol', 'company name', 'quantity', 'avg price', 'current price', 'current value', 'p&l', 'p&l %'];
const GROWW_STATEMENT_HEADERS = ['stock name', 'isin', 'quantity', 'average buy price', 'buy value', 'closing price', 'closing value', 'unrealised p&l'];

/**
 * Map of common company names to NSE symbols.
 * Used when parsing Groww holdings statements that use full company names.
 */
const COMPANY_TO_SYMBOL: Record<string, string> = {
  '360 ONE WAM LIMITED': '360ONE',
  'AAVAS FINANCIERS LIMITED': 'AAVAS',
  'ACME SOLAR HOLDINGS LTD': 'ACME',
  'ADANI PORT & SEZ LTD': 'ADANIPORTS',
  'ADITYA BIRLA CAPITAL LTD.': 'ABCAPITAL',
  'ADVANCED ENZYME TECH LTD': 'ADVENZYMES',
  'AFFLE 3I LIMITED': 'AFFLE',
  'AIA ENGINEERING LIMITED': 'AIAENG',
  'AJANTA PHARMA LIMITED': 'AJANTPHARM',
  'AMARA RAJA ENERGY MOB LTD': 'ARE&M',
  'AMBIKA COTTON MILL LTD.': 'AMBIKACOT',
  'AMBUJA CEMENTS LTD': 'AMBUJACEM',
  'ANAND RATHI WEALTH LTD': 'ANANDRATHI',
  'APL APOLLO TUBES LTD': 'APLAPOLLO',
  'APTUS VALUE HSG FIN I LTD': 'APTUS',
  'ASTER DM HEALTHCARE LTD.': 'ASTERDM',
  'ASTRAL LIMITED': 'ASTRAL',
  'AU SMALL FINANCE BANK LTD': 'AUBANK',
  'AVENUE SUPERMARTS LIMITED': 'DMART',
  'AXIS BANK LIMITED': 'AXISBANK',
  'BANK OF INDIA': 'BANKINDIA',
  'BATA INDIA LTD': 'BATAINDIA',
  'BHARAT DYNAMICS LIMITED': 'BDL',
  'BHARAT PETROLEUM CORP  LT': 'BPCL',
  'BHARTI HEXACOM LIMITED': 'BHARTIHEXA',
  'BHEL': 'BHEL',
  'BLUE STAR LIMITED': 'BLUESTARCO',
  'BOROSIL RENEWABLES LTD': 'BORORENEW',
  'BSE LIMITED': 'BSE',
  'CAPACITE INFRAPROJECT LTD': 'CAPACITE',
  'CESC LTD': 'CESC',
  'CHAMBAL FERTILIZERS LTD': 'CHAMBLFERT',
  'CHOICE INTERNATIONAL LTD': 'CHOICEIN',
  'CIPLA LTD': 'CIPLA',
  'COCHIN SHIPYARD LIMITED': 'COCHINSHIP',
  'COFORGE LIMITED': 'COFORGE',
  'CONTAINER CORP OF IND LTD': 'CONCOR',
  'CONTROL PRINT LIMITED': 'CONTROLPR',
  'CYIENT LIMITED': 'CYIENT',
  'DEEPAK NITRITE LTD': 'DEEPAKNTR',
  'DR. REDDY S LABORATORIES': 'DRREDDY',
  'EIH LIMITED': 'EIHOTEL',
  'ELECON ENG. CO. LTD': 'ELECON',
  'EMAMI LIMITED': 'EMAMILTD',
  'EPL LIMITED': 'EPL',
  'ERIS LIFESCIENCES LIMITED': 'ERIS',
  'ESAB INDIA LTD': 'ESABINDIA',
  'EXIDE INDUSTRIES LTD': 'EXIDEIND',
  'FIEM INDUSTRIES LIMITED': 'FIEMIND',
  'FIRSTSOURCE SOLU. LTD.': 'FSL',
  'GANESHA ECOSPHERE LIMITED': 'GANESHHOUC',
  'GARDEN REACH SHIP&ENG LTD': 'GRSE',
  'GATEWAY DISTRIPARKS LTD': 'GDL',
  'GE VERNOVA T&D INDIA LTD': 'GEVERNOVA',
  'GENUS POWER INFRASTRU LTD': 'GENUSPOWER',
  'GNG ELECTRONICS LIMITED': 'GNG',
  'GUJ NAR VAL FER & CHEM L': 'GNFC',
  'GULF OIL LUB. IND. LTD.': 'GULFOILLUB',
  'HAWKINS COOKERS LTD.': 'HAWKINCOOK',
  'HBL ENGINEERING LTD': 'HBLPOWER',
  'HDFC BANK LTD': 'HDFCBANK',
  'HEIDELBERGCEMENT (I) LTD': 'HEIDELBERG',
  'HERO MOTOCORP LIMITED': 'HEROMOTOCO',
  'HINDALCO  INDUSTRIES  LTD': 'HINDALCO',
  'HINDUSTAN UNILEVER LTD.': 'HINDUNILVR',
  'HONASA CONSUMER LIMITED': 'HONASA',
  'HPL ELECTRIC & POWER LTD': 'HPL',
  'HYUNDAI MOTOR INDIA LTD': 'HYUNDAI',
  'IDFC FIRST BANK LIMITED': 'IDFCFIRSTB',
  'IIFL FINANCE LIMITED': 'IIFL',
  'INDIA SHELTER FIN CORP L': 'INDIASHLTR',
  'INDIAMART INTERMESH LTD': 'INDIAMART',
  'INDIAN BANK': 'INDIANB',
  'INDIGRID INFRASTRUCT TRST': 'INDIGRID',
  'INDUS TOWERS LIMITED': 'INDUSTOWER',
  'INOX INDIA LIMITED': 'INOXINDIA',
  'ITC HOTELS LIMITED': 'ITCHOTELS',
  'ITC LTD': 'ITC',
  'J B CHEMICALS AND PHARMA': 'JBCHEPHARM',
  'JAIN RESOURCE RECYCLING L': 'JAINRESLIF',
  'JASH ENGINEERING LIMITED': 'JASH',
  'JINDAL STAINLESS LIMITED': 'JSL',
  'JIO FIN SERVICES LTD': 'JIOFIN',
  'JK CEMENT LIMITED': 'JKCEMENT',
  'KALPATARU PROJECT INT LTD': 'KPIL',
  'KARUR VYSYA BANK LTD': 'KARURVYSYA',
  'KFIN TECHNOLOGIES LIMITED': 'KFINTECH',
  'KIRLOSKAR PNEUMATIC COM L': 'KIRLPNU',
  'KRISHNA INST OF MED SCI L': 'KIMS',
  "KWALITY WALL'S (INDIA) L": 'HILS',
  'LA OPALA RG LIMITED': 'LAOPALA',
  'LE TRAVENUES TECHNOLOGY L': 'IXIGO',
  'LIFE INSURA CORP OF INDIA': 'LICI',
  'LLOYDS METALS N ENERGY L': 'LLOYDSME',
  'LT FOODS LIMITED': 'LTFOODS',
  'LUPIN LIMITED': 'LUPIN',
  'MAHANAGAR GAS LTD.': 'MGL',
  'MANKIND PHARMA LIMITED': 'MANKIND',
  'MARICO LIMITED': 'MARICO',
  'MARKSANS PHARMA LIMITED': 'MARKSANS',
  'MAX FINANCIAL SERV LTD': 'MFSL',
  'MAZAGON DOCK SHIPBUIL LTD': 'MAZDOCK',
  'METRO BRANDS LIMITED': 'METROBRAND',
  'MISHRA DHATU NIGAM LTD': 'MIDHANI',
  'MPHASIS LIMITED': 'MPHASIS',
  'MUTHOOT FINANCE LIMITED': 'MUTHOOTFIN',
  'NHPC LTD': 'NHPC',
  'NIPPON L I A M LTD': 'NAM-INDIA',
  'ONE 97 COMMUNICATIONS LTD': 'PAYTM',
  'ORACLE FIN SERV SOFT LTD.': 'OFSS',
  'OSWAL PUMPS LIMITED': 'OSWALPUMPS',
  'PCBL CHEMICAL LIMITED': 'PCBL',
  'PERSISTENT SYSTEMS LTD': 'PERSISTENT',
  'PIDILITE INDUSTRIES LTD': 'PIDILITIND',
  'PIRAMAL FINANCE LIMITED': 'PEL',
  'POLYPLEX CORPORATION LTD': 'POLYPLEX',
  'PONDY OXIDES & CHEM LTD': 'POCL',
  'POWER MECH PROJECTS LTD.': 'POWERMECH',
  'RAYMOND LTD': 'RAYMOND',
  'RESTAURANT BRAND ASIA LTD': 'RBA',
  'SERVOTECH REN POW SYS LTD': 'SERVOTECH',
  'SHAKTI PUMPS (I) LTD': 'SHAKTIPUMP',
  'SHIVALIK BIMETAL CON. LTD': 'SBC',
  'SHREE DIGVIJAY CEM CO LTD': 'SDCL',
  'SIEMENS ENERGY INDIA LTD': 'SIEMENS',
  'SIEMENS LTD': 'SIEMENS',
  'SKIPPER LIMITED': 'SKIPPER',
  'SRF LTD': 'SRF',
  'STEEL AUTHORITY OF INDIA': 'SAIL',
  'SUN PHARMACEUTICAL IND L': 'SUNPHARMA',
  'SUPREME INDUSTRIES LTD': 'SUPREMEIND',
  'SYNGENE INTERNATIONAL LTD': 'SYNGENE',
  'SYRMA SGS TECHNOLOGY LTD': 'SYRMA',
  'TATA CAPITAL LIMITED': 'TATACAPFIN',
  'TATA COMMUNICATIONS LTD': 'TATACOMM',
  'TATA MOTORS LIMITED': 'TATAMOTORS',
  'TATA MOTORS PASS VEH LTD': 'TATAMTRDVR',
  'TATA POWER CO LTD': 'TATAPOWER',
  'TATA STEEL LIMITED': 'TATASTEEL',
  'TD POWER SYSTEMS LTD.': 'TDPOWERSYS',
  'TECHNO ELEC & ENG CO. LTD': 'TECHNOE',
  'THE GE SHPG.LTD': 'GESHIP',
  'THE INDIAN HOTELS CO. LTD': 'INDHOTEL',
  'THE UGAR SUGAR WORKS LTD': 'UGARSUGAR',
  'TITAN COMPANY LIMITED': 'TITAN',
  'TORRENT PHARMACEUTICALS L': 'TORNTPHARM',
  'TRANSPORT CORPN OF INDIA': 'TCI',
  'TRANSRAIL LIGHTING LTD': 'TRANSRAIL',
  'TRIDENT LIMITED': 'TRIDENT',
  'TRIVENI TURBINE LIMITED': 'TRITURBINE',
  'UNION BANK OF INDIA': 'UNIONBANK',
  'UTI ASSET MNGMT CO LTD': 'UTIAMC',
  'V-GUARD IND LTD.': 'VGUARD',
  'VEDANTA LIMITED': 'VEDL',
  'WAAREE ENERGIES LIMITED': 'WAAREEENER',
  'WIPRO LTD': 'WIPRO',
  'WOCKHARDT LIMITED': 'WOCKPHARMA',
  'ZYDUS LIFESCIENCES LTD': 'ZYDUSLIFE',
  // ETFs / AMC
  'SBI-ETF NIFTY 50': 'SETFNIF50',
  'NIP IND ETF LIQUID BEES': 'LIQUIDBEES',
  'ZERODHAAMC - GOLDCASE': 'GOLDBEES',
  'ZERODHAAMC - LIQUIDCASE': 'LIQUIDCASE',
  'ZERODHAAMC - SILVERCASE': 'SILVERBEES',
};

/** Try to resolve a company name to an NSE symbol */
function resolveSymbolFromName(name: string): string {
  const upper = name.trim().toUpperCase();
  // Direct lookup
  for (const [key, sym] of Object.entries(COMPANY_TO_SYMBOL)) {
    if (key.toUpperCase() === upper) return sym;
  }
  // Fuzzy: check if name starts with a known key
  for (const [key, sym] of Object.entries(COMPANY_TO_SYMBOL)) {
    if (upper.startsWith(key.toUpperCase().slice(0, 10))) return sym;
  }
  // Fallback: create a rough symbol from name (first word, caps)
  return name.split(/\s+/)[0].toUpperCase().replace(/[^A-Z&]/g, '');
}

/** Strip UTF-8 BOM and normalize line endings */
function sanitize(raw: string): string {
  let s = raw;
  // Remove BOM
  if (s.charCodeAt(0) === 0xfeff) {
    s = s.slice(1);
  }
  // Normalize line endings
  return s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/** Parse a number from a string, stripping commas and percent signs */
function parseNum(val: string): number {
  const cleaned = val.replace(/,/g, '').replace(/%/g, '').trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/** Strip -EQ, -BE, -BL suffixes from Zerodha instrument names */
function cleanSymbol(instrument: string): string {
  return instrument.trim().replace(/-(EQ|BE|BL|SM|ST)$/i, '');
}

/** Detect broker from the header row */
function detectBroker(headerRow: string): Broker | null {
  const lower = headerRow.toLowerCase();
  // Check for distinctive Zerodha headers
  if (lower.includes('instrument') && lower.includes('avg. cost') && lower.includes('ltp')) {
    return 'zerodha';
  }
  // Check for Groww holdings statement (XLSX converted to CSV)
  if (lower.includes('stock name') && lower.includes('isin') && lower.includes('average buy price')) {
    return 'groww_statement';
  }
  // Check for distinctive Groww headers
  if (lower.includes('company name') && lower.includes('avg price')) {
    return 'groww';
  }
  return null;
}

/** Simple CSV line parser that handles quoted fields */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

function parseZerodhaRow(fields: string[]): Holding | null {
  if (fields.length < 8) return null;

  const symbol = cleanSymbol(fields[0]);
  if (!symbol) return null;

  return {
    symbol,
    name: symbol, // Zerodha CSV doesn't include company name
    quantity: parseNum(fields[1]),
    avgPrice: parseNum(fields[2]),
    currentPrice: parseNum(fields[3]),
    currentValue: parseNum(fields[4]),
    pnl: parseNum(fields[5]),
    pnlPercent: parseNum(fields[6]),
    dayChange: parseNum(fields[7]),
  };
}

function parseGrowwStatementRow(fields: string[]): Holding | null {
  if (fields.length < 8) return null;
  // Format: Stock Name, ISIN, Quantity, Average buy price, Buy value, Closing price, Closing value, Unrealised P&L
  const name = fields[0].trim();
  if (!name || name === 'NA') return null;

  const qty = parseNum(fields[2]);
  const avgPrice = parseNum(fields[3]);
  const buyValue = parseNum(fields[4]);
  const closingPrice = parseNum(fields[5]);
  const closingValue = parseNum(fields[6]);
  const pnl = parseNum(fields[7]);

  if (qty === 0 || closingPrice === 0) return null;

  const pnlPercent = buyValue > 0 ? (pnl / buyValue) * 100 : 0;
  const symbol = resolveSymbolFromName(name);

  return {
    symbol,
    name,
    quantity: qty,
    avgPrice,
    currentPrice: closingPrice,
    currentValue: closingValue,
    pnl,
    pnlPercent,
    dayChange: 0,
  };
}

function parseGrowwRow(fields: string[]): Holding | null {
  if (fields.length < 8) return null;

  const symbol = fields[0].trim();
  if (!symbol) return null;

  return {
    symbol,
    name: fields[1].trim() || symbol,
    quantity: parseNum(fields[2]),
    avgPrice: parseNum(fields[3]),
    currentPrice: parseNum(fields[4]),
    currentValue: parseNum(fields[5]),
    pnl: parseNum(fields[6]),
    pnlPercent: parseNum(fields[7]),
    dayChange: 0, // Groww CSV doesn't include day change
  };
}

export interface ParseResult {
  broker: Broker;
  holdings: Holding[];
  errors: string[];
}

/**
 * Parse a portfolio CSV string from Zerodha or Groww.
 * Auto-detects the broker from headers.
 */
export function parsePortfolioCsv(csvContent: string): ParseResult {
  const content = sanitize(csvContent);
  const lines = content.split('\n').filter((l) => l.trim().length > 0);

  if (lines.length < 2) {
    throw new Error('CSV must have at least a header row and one data row.');
  }

  // Scan for the header row (may not be line 0 for Groww statements with metadata)
  let headerIdx = 0;
  let broker: Broker | null = null;
  for (let i = 0; i < Math.min(lines.length, 20); i++) {
    broker = detectBroker(lines[i]);
    if (broker) {
      headerIdx = i;
      break;
    }
  }

  const headerLine = lines[headerIdx];

  if (!broker) {
    throw new Error(
      'Could not detect broker. Expected Zerodha or Groww CSV format. ' +
        'Zerodha headers: Instrument, Qty., Avg. cost, LTP, Cur. val, P&L, Net chg., Day chg. ' +
        'Groww headers: Symbol, Company Name, Quantity, Avg Price, Current Price, Current Value, P&L, P&L %'
    );
  }

  const holdings: Holding[] = [];
  const errors: string[] = [];
  const parser = broker === 'zerodha' ? parseZerodhaRow : broker === 'groww_statement' ? parseGrowwStatementRow : parseGrowwRow;

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    try {
      const fields = parseCsvLine(line);
      const holding = parser(fields);
      if (holding && holding.quantity > 0) {
        holdings.push(holding);
      }
    } catch (err) {
      errors.push(`Row ${i + 1}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { broker, holdings, errors };
}
