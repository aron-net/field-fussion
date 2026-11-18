import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  AuthSessionPayload,
  FarmConflictPayload,
  FarmRecord,
} from '../shared/types/domain.ts';
import type {
  CreateFarmInput,
  UpdateFarmBoundaryInput,
  UpdateFarmInput,
  UpdateProfileInput,
} from '../shared/validation/schemas.ts';

export type QueuedMutation =
  | {
      id: string;
      type: 'update_profile';
      status: 'pending' | 'conflict';
      payload: UpdateProfileInput;
      queuedAt: string;
      attempts: number;
      lastError?: string;
    }
  | {
      id: string;
      type: 'farm_create';
      status: 'pending' | 'conflict';
      tempFarmId: string;
      payload: CreateFarmInput;
      queuedAt: string;
      attempts: number;
      lastError?: string;
    }
  | {
      id: string;
      type: 'farm_update';
      status: 'pending' | 'conflict';
      farmId: string;
      expectedVersion: number;
      payload: UpdateFarmInput;
      queuedAt: string;
      attempts: number;
      lastError?: string;
      conflictPayload?: FarmConflictPayload;
    }
  | {
      id: string;
      type: 'farm_boundary_update';
      status: 'pending' | 'conflict';
      farmId: string;
      expectedVersion: number;
      payload: UpdateFarmBoundaryInput;
      queuedAt: string;
      attempts: number;
      lastError?: string;
      conflictPayload?: FarmConflictPayload;
    };

interface FieldFussionOfflineSchema extends DBSchema {
  sessionCache: {
    key: string;
    value: {
      key: string;
      payload: AuthSessionPayload;
      cachedAt: string;
    };
  };
  farmsCache: {
    key: string;
    value: {
      key: string;
      farms: FarmRecord[];
      cachedAt: string;
    };
  };
  syncQueue: {
    key: string;
    value: QueuedMutation;
  };
}

const DB_NAME = 'field_fussion_offline_v1';
const DB_VERSION = 2;

let dbPromise: Promise<IDBPDatabase<FieldFussionOfflineSchema>> | null = null;

function getOfflineDb() {
  if (!dbPromise) {
    dbPromise = openDB<FieldFussionOfflineSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('sessionCache')) {
          db.createObjectStore('sessionCache', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('farmsCache')) {
          db.createObjectStore('farmsCache', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('syncQueue')) {
          db.createObjectStore('syncQueue', { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
}

export async function saveCachedSession(
  firebaseUid: string,
  payload: AuthSessionPayload
): Promise<string> {
  const db = await getOfflineDb();
  const cachedAt = new Date().toISOString();
  await db.put('sessionCache', {
    key: `session:${firebaseUid}`,
    payload,
    cachedAt,
  });
  return cachedAt;
}

export async function loadCachedSession(firebaseUid: string): Promise<{
  payload: AuthSessionPayload;
  cachedAt: string;
} | null> {
  const db = await getOfflineDb();
  const record = await db.get('sessionCache', `session:${firebaseUid}`);
  if (!record) return null;
  return { payload: record.payload, cachedAt: record.cachedAt };
}

export async function saveCachedFarms(
  firebaseUid: string,
  farms: FarmRecord[]
): Promise<string> {
  const db = await getOfflineDb();
  const cachedAt = new Date().toISOString();
  await db.put('farmsCache', {
    key: `farms:${firebaseUid}`,
    farms,
    cachedAt,
  });
  return cachedAt;
}

export async function loadCachedFarms(firebaseUid: string): Promise<{
  farms: FarmRecord[];
  cachedAt: string;
} | null> {
  const db = await getOfflineDb();
  const record = await db.get('farmsCache', `farms:${firebaseUid}`);
  if (!record) return null;
  return { farms: record.farms, cachedAt: record.cachedAt };
}

export async function enqueueProfileUpdate(
  payload: UpdateProfileInput
): Promise<QueuedMutation> {
  const db = await getOfflineDb();
  const item: QueuedMutation = {
    id: `profile_update_${Date.now()}`,
    type: 'update_profile',
    status: 'pending',
    payload,
    queuedAt: new Date().toISOString(),
    attempts: 0,
  };
  await db.put('syncQueue', item);
  return item;
}

export async function enqueueFarmCreate(
  tempFarmId: string,
  payload: CreateFarmInput
): Promise<QueuedMutation> {
  const db = await getOfflineDb();
  const item: QueuedMutation = {
    id: `farm_create_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    type: 'farm_create',
    status: 'pending',
    tempFarmId,
    payload,
    queuedAt: new Date().toISOString(),
    attempts: 0,
  };
  await db.put('syncQueue', item);
  return item;
}

export async function enqueueFarmUpdate(
  farmId: string,
  expectedVersion: number,
  payload: UpdateFarmInput
): Promise<QueuedMutation> {
  const db = await getOfflineDb();
  const item: QueuedMutation = {
    id: `farm_update_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    type: 'farm_update',
    status: 'pending',
    farmId,
    expectedVersion,
    payload,
    queuedAt: new Date().toISOString(),
    attempts: 0,
  };
  await db.put('syncQueue', item);
  return item;
}

export async function enqueueFarmBoundaryUpdate(
  farmId: string,
  expectedVersion: number,
  payload: UpdateFarmBoundaryInput
): Promise<QueuedMutation> {
  const db = await getOfflineDb();
  const item: QueuedMutation = {
    id: `farm_boundary_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    type: 'farm_boundary_update',
    status: 'pending',
    farmId,
    expectedVersion,
    payload,
    queuedAt: new Date().toISOString(),
    attempts: 0,
  };
  await db.put('syncQueue', item);
  return item;
}

export async function listQueuedMutations(): Promise<QueuedMutation[]> {
  const db = await getOfflineDb();
  const rows = await db.getAll('syncQueue');
  return rows.map((row) => ({
    ...row,
    status: row.status ?? 'pending',
  }));
}

export async function removeQueuedMutation(id: string): Promise<void> {
  const db = await getOfflineDb();
  await db.delete('syncQueue', id);
}

export async function markQueuedMutationFailed(
  item: QueuedMutation,
  errorMessage: string
): Promise<void> {
  const db = await getOfflineDb();
  await db.put('syncQueue', {
    ...item,
    attempts: item.attempts + 1,
    lastError: errorMessage,
  });
}

export async function markQueuedMutationConflict(
  item: Extract<QueuedMutation, { type: 'farm_update' | 'farm_boundary_update' }>,
  conflictPayload: FarmConflictPayload,
  errorMessage: string
): Promise<void> {
  const db = await getOfflineDb();
  await db.put('syncQueue', {
    ...item,
    status: 'conflict',
    attempts: item.attempts + 1,
    lastError: errorMessage,
    conflictPayload,
  });
}

export async function remapTempFarmIdInQueue(
  tempFarmId: string,
  realFarmId: string,
  realVersion: number
): Promise<void> {
  const db = await getOfflineDb();
  const all = await db.getAll('syncQueue');
  for (const item of all) {
    if (
      (item.type === 'farm_update' || item.type === 'farm_boundary_update') &&
      item.farmId === tempFarmId
    ) {
      await db.put('syncQueue', {
        ...item,
        farmId: realFarmId,
        expectedVersion: realVersion,
        payload: {
          ...item.payload,
          expectedVersion: realVersion,
        },
      } as QueuedMutation);
    }
  }
}
