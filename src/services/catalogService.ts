import type { CreateStoreBody, StoreListQuery, UpdateStoreBody } from "../schemas/catalogSchemas";
import type { PaginatedResponse } from "../types/api";
import type { Store, UserRole } from "../types/domain";
import type { Coordinates } from "../utils/geoDistance";
import { distanceKmBetween, formatDistanceText, geoBoundingBox, isValidCoordinates, roundDistanceKm } from "../utils/geoDistance";
import { assertOwnerOrAdmin, getRange, handleSupabaseError, requireRecord, supabaseAdmin, toPagination } from "./supabaseService";

// NOTE: public.products and public.vouchers were removed by the 014 migration — they
// backed the old customer-facing marketplace (browse/buy surplus food), which no
// longer exists now that the platform is partner-donates-to-charity only. This service
// used to also expose listProducts/getProduct/createProduct/updateProduct/deleteProduct/
// listVouchers/createVoucher; those were deleted along with the dropped tables instead
// of being left calling tables that no longer exist.
const storeSelect = "*";
const proximityCandidateLimit = 1000;

const queryLocation = (query: StoreListQuery): Coordinates | null => {
  const latitude = query.latitude ?? query.lat;
  const longitude = query.longitude ?? query.lng;
  const coordinates: Partial<Coordinates> = {};
  if (latitude !== undefined) coordinates.latitude = latitude;
  if (longitude !== undefined) coordinates.longitude = longitude;
  return isValidCoordinates(coordinates) ? coordinates : null;
};

const storeDistance = (store: Store, userLocation: Coordinates): Store => {
  const storeLocation = {
    latitude: Number(store.latitude),
    longitude: Number(store.longitude)
  };

  if (!isValidCoordinates(storeLocation)) return { ...store, distance_km: null, distance_text: null };
  const rawDistanceKm = distanceKmBetween(userLocation, storeLocation);
  const distanceKm = roundDistanceKm(rawDistanceKm);
  return {
    ...store,
    distance_km: distanceKm,
    distance_text: formatDistanceText(rawDistanceKm)
  };
};

const getStoreOwner = async (storeId: string): Promise<string> => {
  const { data, error } = await supabaseAdmin
    .from("stores")
    .select("owner_id")
    .eq("id", storeId)
    .single();

  if (error) handleSupabaseError(error, "Failed to load store ownership");
  const store = data as { owner_id: string } | null;
  return requireRecord(store, "Store was not found").owner_id;
};

export const catalogService = {
  async listStores(query: StoreListQuery): Promise<PaginatedResponse<Store>> {
    const { from, to } = getRange(query);
    const userLocation = queryLocation(query);
    let request = supabaseAdmin
      .from("stores")
      .select(storeSelect, { count: "exact" })
      .eq("status", "active");

    if (query.search) request = request.or(`name.ilike.%${query.search}%,street.ilike.%${query.search}%`);
    if (query.ward) request = request.eq("ward", query.ward);
    if (query.verified !== undefined) request = request.eq("is_verified", query.verified);
    if (query.open !== undefined) request = request.eq("is_open", query.open);

    if (userLocation) {
      const bounds = geoBoundingBox(userLocation, query.radius_km);
      request = request
        .not("latitude", "is", null)
        .not("longitude", "is", null)
        .gte("latitude", bounds.minLatitude)
        .lte("latitude", bounds.maxLatitude)
        .gte("longitude", bounds.minLongitude)
        .lte("longitude", bounds.maxLongitude)
        .range(0, proximityCandidateLimit - 1);
    } else {
      request = request.range(from, to).order("rating", { ascending: false });
    }

    const { data, error, count } = await request;
    if (error) handleSupabaseError(error, "Failed to list stores");

    if (userLocation) {
      const nearbyStores = ((data ?? []) as Store[])
        .map((store) => storeDistance(store, userLocation))
        .filter((store) => store.distance_km !== null && store.distance_km !== undefined && store.distance_km <= query.radius_km)
        .sort((a, b) => (a.distance_km ?? Number.POSITIVE_INFINITY) - (b.distance_km ?? Number.POSITIVE_INFINITY));

      return {
        items: nearbyStores.slice(from, to + 1),
        pagination: toPagination(query.page, query.limit, nearbyStores.length)
      };
    }

    return {
      items: (data ?? []) as Store[],
      pagination: toPagination(query.page, query.limit, count ?? 0)
    };
  },

  async getStore(storeId: string): Promise<Store> {
    const { data, error } = await supabaseAdmin
      .from("stores")
      .select(storeSelect)
      .eq("id", storeId)
      .single();

    if (error) handleSupabaseError(error, "Failed to load store");
    return data as Store;
  },

  async createStore(actorId: string, body: CreateStoreBody): Promise<Store> {
    const { data, error } = await supabaseAdmin
      .from("stores")
      .insert({
        ...body,
        owner_id: actorId,
        status: "pending"
      })
      .select("*")
      .single();

    if (error) handleSupabaseError(error, "Failed to create store");
    return data as Store;
  },

  async updateStore(actorId: string, actorRole: UserRole, storeId: string, body: UpdateStoreBody): Promise<Store> {
    const ownerId = await getStoreOwner(storeId);
    assertOwnerOrAdmin(ownerId, actorId, actorRole);

    const { data, error } = await supabaseAdmin
      .from("stores")
      .update(body)
      .eq("id", storeId)
      .select("*")
      .single();

    if (error) handleSupabaseError(error, "Failed to update store");
    return data as Store;
  }
};
