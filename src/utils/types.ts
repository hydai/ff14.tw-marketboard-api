// Universalis API response types
export interface UniversalisMultiResponse {
  itemIDs: number[];
  items: Record<string, UniversalisItemData>;
  dcName: string;
}

export interface UniversalisItemData {
  itemID: number;
  lastUploadTime: number;
  listings: UniversalisListing[];
  recentHistory: UniversalisSale[];
  currentAveragePrice: number;
  currentAveragePriceNQ: number;
  currentAveragePriceHQ: number;
  regularSaleVelocity: number;
  nqSaleVelocity: number;
  hqSaleVelocity: number;
  averagePrice: number;
  averagePriceNQ: number;
  averagePriceHQ: number;
  minPrice: number;
  minPriceNQ: number;
  minPriceHQ: number;
  maxPrice: number;
  maxPriceNQ: number;
  maxPriceHQ: number;
  listingsCount: number;
  unitsForSale: number;
  unitsSold: number;
  worldUploadTimes: Record<string, number>;
}

export interface UniversalisListing {
  listingID: string;
  lastReviewTime: number;
  pricePerUnit: number;
  quantity: number;
  total: number;
  tax: number;
  hq: boolean;
  retainerName: string;
  retainerCity: number;
  creatorName: string;
  worldID: number;
  worldName: string;
}

export interface UniversalisSale {
  hq: boolean;
  pricePerUnit: number;
  quantity: number;
  timestamp: number;
  buyerName: string;
  total: number;
  worldID: number;
  worldName: string;
}

export interface UniversalisAggregatedResponse {
  results: UniversalisAggregatedItem[];
}

export interface UniversalisAggregatedItem {
  itemID: number;
  nq: UniversalisAggregatedData;
  hq: UniversalisAggregatedData;
  worldID: number;
  worldName: string;
}

export interface UniversalisAggregatedData {
  minListing: { world: { id: number; name: string }; dc: { id: number; name: string }; price: number } | null;
  listings: { count: number; avg: number };
  recentHistory: { count: number; avg: number };
}

// Tax rates from Universalis
export interface UniversalisTaxRates {
  [worldId: string]: {
    "Limsa Lominsa": number;
    Gridania: number;
    "Ul'dah": number;
    Ishgard: number;
    Kugane: number;
    Crystarium: number;
    "Old Sharlayan": number;
    Tuliyollal: number;
  };
}

// XIVAPI item data
export interface XIVAPIItem {
  row_id: number;
  fields: {
    Name: string;
    "Name@ja": string;
    "Name@zh": string;
    Icon: { id: number; path: string; path_hr: string };
    ItemSearchCategory: { row_id: number; fields?: { Name: string } } | null;
    CanBeHq: boolean;
    StackSize: number;
  };
}

// API response types
export interface PriceSummary {
  itemId: number;
  minPriceNQ: number | null;
  minPriceHQ: number | null;
  avgPriceNQ: number | null;
  avgPriceHQ: number | null;
  listingCount: number;
  saleVelocityNQ: number;
  saleVelocityHQ: number;
  cheapestWorld: string | null;
  lastUpdated: string;
}

export interface ListingResponse {
  itemId: number;
  world?: string;
  listings: {
    listingId: string;
    worldName: string;
    pricePerUnit: number;
    quantity: number;
    total: number;
    tax: number;
    hq: boolean;
    retainerName: string;
    retainerCity: number;
    lastReviewTime: string;
  }[];
  updatedAt: string;
}

export interface SaleRecord {
  worldName: string;
  pricePerUnit: number;
  quantity: number;
  total: number;
  hq: boolean;
  buyerName: string;
  soldAt: string;
}

export interface ArbitrageOpportunity {
  itemId: number;
  itemName: string;
  buyWorld: string;
  buyPrice: number;
  sellWorld: string;
  sellPrice: number;
  profitPerUnit: number;
  profitPercent: number;
  hq: boolean;
}

export interface TrendingItem {
  itemId: number;
  itemName: string;
  direction: "up" | "down";
  currentPrice: number;
  previousPrice: number;
  changePercent: number;
  period: string;
}

export interface DealItem {
  itemId: number;
  itemName: string;
  worldName: string;
  currentPrice: number;
  averagePrice: number;
  discount: number;
  hq: boolean;
}

export interface VelocityItem {
  itemId: number;
  itemName: string;
  salesPerDay: number;
  avgPrice: number;
  totalGilPerDay: number;
}
