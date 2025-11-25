import { cirrus } from "../../utils/mercataApiHelper";

export interface StorageHistoryElement {
  address: string;
  data: any;
  valid_from: string;
  valid_to: string;
}

export interface MappingHistoryElement {
  address: string;
  collection_name: string;
  key: any;
  path: string;
  value: any;
  valid_from: string;
  valid_to: string;
}

export interface HistoryParams {
  endTimestamp: number;
  interval: number;
  numTicks: number;
}

export interface HistorySnapshot {
  timestamp: number;
  data: any;
}

export const getHistoryParams = (duration?: string, end?: string): HistoryParams => {
  const endTimestamp = end ? Date.parse(end) : Date.now();
  switch (duration) {
    case '5d': {
      return {
        endTimestamp,
        interval: 1000 * 60 * 30, // 30 minutes
        numTicks: 5 * 48
      }
    }
    case '7d': {
      return {
        endTimestamp,
        interval: 1000 * 60 * 30, // 30 minutes
        numTicks: 7 * 48
      }
    }
    case '1m': {
      return {
        endTimestamp,
        interval: 1000 * 60 * 60 * 2, // 2 hours
        numTicks: 372 // 1 month
      }
    }
    case '3m': {
      return {
        endTimestamp,
        interval: 1000 * 60 * 60 * 6, // 6 hours
        numTicks: 368 // 3 months
      }
    }
    case '6m': {
      return {
        endTimestamp,
        interval: 1000 * 60 * 60 * 12, // 12 hours
        numTicks: 366 // 6 months
      }
    }
    case '1y': {
      return {
        endTimestamp,
        interval: 1000 * 60 * 60 * 24, // 1 day
        numTicks: 366 // 12 months
      }
    }
    case 'all': {
      const genesisTimestamp = Date.parse('2025-10-30T00:00:00Z');
      const dt = endTimestamp - genesisTimestamp;
      return {
        endTimestamp,
        interval: Number(dt/360),
        numTicks: 360
      }
    }
    default: {
      return {
        endTimestamp,
        interval: 1000 * 5 * 60, // 5 minutes
        numTicks: 12 * 24 // 5 minutes * 288 = 24 hours
      }
    }
  }
}

export const getHistory = async (
  accessToken: string,
  params: HistoryParams,
  storageFilters: string[],
  mappingFilters: string[],
  mappingCollectionNames: string[],
  initialSnapshotData: any,
  storageReducer: (data: any, element: StorageHistoryElement) => any,
  mappingReducer: (data: any, element: MappingHistoryElement) => any,
  snapshotFn: (snapshot: HistorySnapshot, index: number) => HistorySnapshot
): Promise<HistorySnapshot[]> => {
  const endTimestamp = params.endTimestamp;
  const interval = params.interval;
  const numTicks = params.numTicks;
  const startTimestamp = endTimestamp - (interval * numTicks);
  const startTime = (new Date(startTimestamp)).toISOString();
  const endTime = (new Date(endTimestamp)).toISOString();
  const [storageRes, mappingRes] = await Promise.all([
    await cirrus.get(accessToken, "/history@storage", {
      params: {
        or: `(${storageFilters && storageFilters.length > 0 ? storageFilters.join(',') : 'address.eq.0'})`,
        valid_from: `lte.${endTime}`,
        valid_to: `gte.${startTime}`,
        select: 'address,data,valid_from,valid_to'
      },
    }),
    await cirrus.get(accessToken, "/history@mapping", {
      params: {
        or: `(${mappingFilters && mappingFilters.length > 0 ? mappingFilters.join(',') : 'address.eq.0'})`,
        valid_from: `lte.${endTime}`,
        valid_to: `gte.${startTime}`,
        collection_name: `in.(${mappingCollectionNames.join(',')})`,
        select: 'address,collection_name,key,path,value,valid_from,valid_to'
      },
    })
  ]);

  const storageHistory = storageRes.data as StorageHistoryElement[];
  const mappingHistory = mappingRes.data as MappingHistoryElement[];
  const snapshots: any[] = (new Array(numTicks + 1)).fill({}).map((_, i) => { return {
    timestamp: endTimestamp - (interval * (numTicks - i)),
    data: initialSnapshotData
  }; });

  storageHistory.forEach((h) => {
    const validFrom = Date.parse(h.valid_from + 'Z');
    const validTo = h.valid_to === 'infinity' ? Number.MAX_SAFE_INTEGER : Date.parse(h.valid_to + 'Z');
    if (validFrom <= startTimestamp && validTo >= endTimestamp) {
      for (let i = 0; i < snapshots.length; i++) {
        snapshots[i].data = storageReducer(snapshots[i].data, h);
      }
    } else if (validFrom <= startTimestamp) {
      for (let i = 0; i < snapshots.length; i++) {
        if (snapshots[i].timestamp <= validTo) {
          snapshots[i].data = storageReducer(snapshots[i].data, h);
        } else {
          break;
        }
      }
    } else if (validTo >= endTimestamp) {
      for (let i = snapshots.length - 1; i >= 0; i--) {
        if (snapshots[i].timestamp >= validFrom) {
          snapshots[i].data = storageReducer(snapshots[i].data, h);
        } else {
          break;
        }
      }
    } else {
      for (let i = 0; i < snapshots.length; i++) {
        if (snapshots[i].timestamp >= validFrom && snapshots[i].timestamp <= validTo) {
          snapshots[i].data = storageReducer(snapshots[i].data, h);
        }
        if (snapshots[i].timestamp > validTo) {
          break;
        }
      }
    }
  });

  mappingHistory.forEach((h) => {
    const validFrom = Date.parse(h.valid_from + 'Z');
    const validTo = h.valid_to === 'infinity' ? Number.MAX_SAFE_INTEGER : Date.parse(h.valid_to + 'Z');
    if (validFrom <= startTimestamp && validTo >= endTimestamp) {
      for (let i = 0; i < snapshots.length; i++) {
        snapshots[i].data = mappingReducer(snapshots[i].data, h);
      }
    } else if (validFrom <= startTimestamp) {
      for (let i = 0; i < snapshots.length; i++) {
        if (snapshots[i].timestamp <= validTo) {
          snapshots[i].data = mappingReducer(snapshots[i].data, h);
        } else {
          break;
        }
      }
    } else if (validTo >= endTimestamp) {
      for (let i = snapshots.length - 1; i >= 0; i--) {
        if (snapshots[i].timestamp >= validFrom) {
          snapshots[i].data = mappingReducer(snapshots[i].data, h);
        } else {
          break;
        }
      }
    } else {
      for (let i = 0; i < snapshots.length; i++) {
        if (snapshots[i].timestamp >= validFrom && snapshots[i].timestamp <= validTo) {
          snapshots[i].data = mappingReducer(snapshots[i].data, h);
        }
        if (snapshots[i].timestamp > validTo) {
          break;
        }
      }
    }
  });

  return snapshots.map((snapshot, i) => snapshotFn(snapshot, i));
};