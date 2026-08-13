import { handleSupabaseError, supabaseAdmin } from "./supabaseService";

// NOTE: the old dashboard queried "orders", "products" and "complaints" — all three
// tables were removed by the 014 migration (customer/marketplace features are gone).
// The partner dashboard now only reports on stores + donations, the tables that still
// exist in the new schema.
export const partnerService = {
  async getDashboard(ownerId: string): Promise<unknown> {
    const { data: stores, error: storeError } = await supabaseAdmin
      .from("stores")
      .select("id,name,rating,is_open,status")
      .eq("owner_id", ownerId);

    if (storeError) handleSupabaseError(storeError, "Failed to load stores");
    const storeIds = (stores ?? []).map((store) => (store as { id: string }).id);
    const emptyStoreId = "00000000-0000-0000-0000-000000000000";

    const { data: donations, error: donationError } = await supabaseAdmin
      .from("donations")
      .select("id,status,weight_kg")
      .in("store_id", storeIds.length > 0 ? storeIds : [emptyStoreId]);

    if (donationError) handleSupabaseError(donationError, "Failed to load partner donations");

    const completedDonations = (donations ?? []).filter((donation) => (donation as { status: string }).status === "completed");

    return {
      stores: stores ?? [],
      metrics: {
        store_count: storeIds.length,
        active_donation_count: (donations ?? []).filter((donation) => !["completed", "cancelled"].includes((donation as { status: string }).status)).length,
        donation_count: completedDonations.length,
        donated_weight_kg: completedDonations.reduce((sum, donation) => sum + Number((donation as { weight_kg: number }).weight_kg ?? 0), 0)
      }
    };
  }
};
