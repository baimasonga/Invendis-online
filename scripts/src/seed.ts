import { db } from "@workspace/db";
import {
  usersTable, districtsTable, chiefdomsTable, sectionsTable, communitiesTable,
  valueChainsTable, warehousesTable, inputItemsTable, farmersTable,
  stockBalanceTable, stockLedgerTable, campaignsTable, vehiclesTable, driversTable
} from "@workspace/db";
import bcrypt from "bcryptjs";

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

async function seed() {
  console.log("Seeding database...");

  // Districts
  console.log("Creating districts...");
  const districts = await db.insert(districtsTable).values([
    { name: "Bo", code: "BO" },
    { name: "Bombali", code: "BM" },
    { name: "Bonthe", code: "BT" },
    { name: "Kailahun", code: "KL" },
    { name: "Kambia", code: "KB" },
    { name: "Kenema", code: "KN" },
    { name: "Koinadugu", code: "KG" },
    { name: "Kono", code: "KO" },
    { name: "Moyamba", code: "MY" },
    { name: "Port Loko", code: "PL" },
    { name: "Pujehun", code: "PJ" },
    { name: "Tonkolili", code: "TK" },
    { name: "Western Area Rural", code: "WR" },
    { name: "Western Area Urban", code: "WU" },
  ]).onConflictDoNothing().returning();

  const [bo, bombali, kenema] = districts.length > 0 ? districts : await db.select().from(districtsTable).limit(3);

  // Chiefdoms
  const chiefdoms = await db.insert(chiefdomsTable).values([
    { name: "Kakua", districtId: bo?.id ?? 1 },
    { name: "Lugbu", districtId: bo?.id ?? 1 },
    { name: "Gbendembu Ngowahun", districtId: bombali?.id ?? 2 },
    { name: "Makari Gbanti", districtId: bombali?.id ?? 2 },
    { name: "Nongowa", districtId: kenema?.id ?? 6 },
    { name: "Small Bo", districtId: kenema?.id ?? 6 },
  ]).onConflictDoNothing().returning();

  // Value Chains
  console.log("Creating value chains...");
  const valueChains = await db.insert(valueChainsTable).values([
    { name: "Invalley Swamp", description: "Invalley swamp rice production" },
    { name: "Tree Crops", description: "Oil palm and cocoa production" },
    { name: "Vegetables", description: "Bulb pepper and onions production" },
    { name: "Infrastructure", description: "Roads, grain stores, and other infrastructure" },
    { name: "Agribusiness", description: "Agricultural business and enterprise development" },
    { name: "Adaptation", description: "Farmer feed schools and other adaptation programs" },
  ]).onConflictDoNothing().returning();

  // Warehouses
  console.log("Creating warehouses...");
  await db.insert(warehousesTable).values([
    { name: "Bo Central Warehouse", code: "WH-BO-01", districtId: bo?.id ?? 1, address: "Bo City, Southern Province" },
    { name: "Makeni Distribution Hub", code: "WH-BM-01", districtId: bombali?.id ?? 2, address: "Makeni City, Northern Province" },
    { name: "Kenema Regional Store", code: "WH-KN-01", districtId: kenema?.id ?? 6, address: "Kenema City, Eastern Province" },
    { name: "Freetown Central", code: "WH-WU-01", address: "Freetown, Western Area" },
  ]).onConflictDoNothing();

  // Input Items
  console.log("Creating input items...");
  const [riceVC, cassavaVC, maizeVC, groundnutVC] = valueChains.length > 0 ? valueChains : await db.select().from(valueChainsTable).limit(4);
  const inputItems = await db.insert(inputItemsTable).values([
    { itemCode: "SEED-RICE-01", name: "Improved Rice Seed (NERICA)", unit: "kg", category: "Seed", valueChainId: riceVC?.id },
    { itemCode: "SEED-RICE-02", name: "Swamp Rice Seed (ROK 5)", unit: "kg", category: "SEED", valueChainId: riceVC?.id },
    { itemCode: "FERT-NPK-01", name: "NPK Fertilizer (15:15:15)", unit: "bag", category: "Fertilizer" },
    { itemCode: "FERT-UREA-01", name: "Urea Fertilizer (46%N)", unit: "bag", category: "Fertilizer" },
    { itemCode: "SEED-CASS-01", name: "Cassava Cuttings (TMEB419)", unit: "bundle", category: "Seed", valueChainId: cassavaVC?.id },
    { itemCode: "SEED-MAIZ-01", name: "Hybrid Maize Seed (OBA SUPER)", unit: "kg", category: "Seed", valueChainId: maizeVC?.id },
    { itemCode: "CHEM-HERB-01", name: "Glyphosate Herbicide", unit: "litre", category: "Chemical" },
    { itemCode: "TOOL-HOE-01", name: "Long-handled Hoe", unit: "piece", category: "Tool" },
    { itemCode: "TOOL-KNAP-01", name: "Knapsack Sprayer", unit: "piece", category: "Tool" },
  ]).onConflictDoNothing().returning();

  // Stock for warehouses
  const wh1Items = inputItems.length > 0 ? inputItems.slice(0, 4) : await db.select().from(inputItemsTable).limit(4);
  const warehouses = await db.select().from(warehousesTable).limit(2);

  if (warehouses.length > 0 && wh1Items.length > 0) {
    for (const item of wh1Items) {
      const available = Math.floor(Math.random() * 500) + 100;
      await db.insert(stockBalanceTable).values({
        warehouseId: warehouses[0].id,
        inputItemId: item.id,
        available,
        reserved: Math.floor(available * 0.1),
      }).onConflictDoNothing();
      await db.insert(stockLedgerTable).values({
        warehouseId: warehouses[0].id,
        inputItemId: item.id,
        txnType: "RECEIVE",
        quantity: available,
        reference: "INITIAL-STOCK",
        notes: "Initial seed stock",
      }).onConflictDoNothing();
    }
    if (warehouses.length > 1) {
      for (const item of wh1Items.slice(0, 2)) {
        await db.insert(stockBalanceTable).values({
          warehouseId: warehouses[1].id,
          inputItemId: item.id,
          available: Math.floor(Math.random() * 300) + 50,
        }).onConflictDoNothing();
      }
    }
  }

  // Users
  console.log("Creating users...");
  await db.insert(usersTable).values([
    {
      username: "admin",
      passwordHash: await hashPassword("admin123"),
      fullName: "System Administrator",
      email: "admin@agripo.sl",
      role: "Admin",
    },
    {
      username: "pm.john",
      passwordHash: await hashPassword("password123"),
      fullName: "John Kamara",
      email: "john.kamara@agripo.sl",
      role: "ProjectManager",
    },
    {
      username: "wm.amara",
      passwordHash: await hashPassword("password123"),
      fullName: "Amara Sesay",
      email: "amara.sesay@agripo.sl",
      role: "WarehouseManager",
      districtId: bo?.id,
    },
    {
      username: "fo.fatima",
      passwordHash: await hashPassword("password123"),
      fullName: "Fatima Conteh",
      email: "fatima.conteh@agripo.sl",
      role: "FieldOfficer",
      districtId: bo?.id,
    },
    {
      username: "dc.ibrahim",
      passwordHash: await hashPassword("password123"),
      fullName: "Ibrahim Bangura",
      email: "ibrahim.bangura@agripo.sl",
      role: "DistrictCoordinator",
      districtId: kenema?.id,
    },
    {
      username: "viewer",
      passwordHash: await hashPassword("password123"),
      fullName: "View Only User",
      email: "viewer@agripo.sl",
      role: "Viewer",
    },
  ]).onConflictDoNothing();

  // Vehicles
  console.log("Creating vehicles...");
  await db.insert(vehiclesTable).values([
    { vehicleCode: "VEH-001", plateNumber: "SLL-1234", vehicleType: "Truck", make: "Isuzu", model: "NMR", year: 2020, capacity: 5000, status: "Active" },
    { vehicleCode: "VEH-002", plateNumber: "SLL-5678", vehicleType: "Pickup", make: "Toyota", model: "Hilux", year: 2021, capacity: 1000, status: "Active" },
    { vehicleCode: "VEH-003", plateNumber: "SLL-9012", vehicleType: "Van", make: "Nissan", model: "Urvan", year: 2019, capacity: 2000, status: "Active" },
    { vehicleCode: "VEH-004", plateNumber: "SLL-3456", vehicleType: "Truck", make: "MAN", model: "TGS", year: 2018, capacity: 8000, status: "InTransit", lastLatitude: 7.9465, lastLongitude: -11.7777, lastPing: new Date() },
  ]).onConflictDoNothing();

  // Drivers
  await db.insert(driversTable).values([
    { driverCode: "DRV-001", fullName: "Mohamed Koroma", phone: "+23276000001", licenseNumber: "DL-2020-001" },
    { driverCode: "DRV-002", fullName: "Alpha Jalloh", phone: "+23276000002", licenseNumber: "DL-2021-002" },
    { driverCode: "DRV-003", fullName: "Sorie Turay", phone: "+23276000003", licenseNumber: "DL-2019-003" },
  ]).onConflictDoNothing();

  // Farmers
  console.log("Creating sample farmers...");
  const farmerData = [];
  const firstNames = ["Mariama", "Aminata", "Isata", "Kadiatu", "Baindu", "Mohamed", "Alpha", "Sorie", "Ibrahim", "Foday"];
  const lastNames = ["Kamara", "Sesay", "Conteh", "Bangura", "Koroma", "Jalloh", "Turay", "Fofanah", "Mansaray", "Kargbo"];
  
  for (let i = 0; i < 25; i++) {
    const gender = i % 3 === 0 ? "Male" : "Female";
    const firstName = firstNames[i % firstNames.length];
    const lastName = lastNames[Math.floor(i / 2) % lastNames.length];
    const status = i < 15 ? "approved" : i < 20 ? "pending" : "rejected";
    
    farmerData.push({
      farmerCode: `FRM-${String(i + 1).padStart(4, "0")}`,
      firstName,
      lastName,
      gender,
      phone: `+2327${7000000 + i}`,
      districtId: i % 2 === 0 ? (bo?.id ?? 1) : (bombali?.id ?? 2),
      valueChainId: (valueChains.length > 0 ? valueChains[i % 4]?.id : null) ?? 1,
      farmSize: 0.5 + (i % 5) * 0.25,
      gpsLatitude: 7.9465 + (Math.random() - 0.5) * 0.5,
      gpsLongitude: -11.7777 + (Math.random() - 0.5) * 0.5,
      status,
      barcodeToken: `BC${String(i + 1).padStart(8, "0")}`,
      ageGroup: i % 3 === 0 ? "18-35" : i % 3 === 1 ? "36-50" : "51+",
    });
  }
  await db.insert(farmersTable).values(farmerData).onConflictDoNothing();

  // Campaigns
  console.log("Creating campaigns...");
  const campaignList = await db.insert(campaignsTable).values([
    {
      campaignCode: "CAM-2024-001",
      name: "2024 Raining Season - Bo District Rice",
      season: "2024 Raining Season",
      districtId: bo?.id ?? 1,
      valueChainId: riceVC?.id ?? 1,
      startDate: new Date("2024-05-01"),
      endDate: new Date("2024-06-30"),
      status: "Active",
      totalFarmers: 150,
      allocatedFarmers: 120,
      deliveredCount: 95,
      notes: "MOFA-SLARI partnership programme - Bo District",
    },
    {
      campaignCode: "CAM-2024-002",
      name: "2024 Dry Season - Bombali Maize",
      season: "2024 Dry Season",
      districtId: bombali?.id ?? 2,
      valueChainId: maizeVC?.id ?? 3,
      startDate: new Date("2024-11-01"),
      endDate: new Date("2024-12-31"),
      status: "Submitted",
      totalFarmers: 80,
      allocatedFarmers: 0,
      deliveredCount: 0,
    },
    {
      campaignCode: "CAM-2025-001",
      name: "2025 Raining Season - Kenema Cassava",
      season: "2025 Raining Season",
      districtId: kenema?.id ?? 6,
      valueChainId: cassavaVC?.id ?? 2,
      startDate: new Date("2025-05-15"),
      endDate: new Date("2025-07-31"),
      status: "Draft",
      totalFarmers: 200,
      allocatedFarmers: 0,
      deliveredCount: 0,
    },
  ]).onConflictDoNothing().returning();

  console.log("✅ Database seeded successfully!");
  console.log("\nLogin credentials:");
  console.log("  Admin:     username=admin      password=admin123");
  console.log("  Manager:   username=pm.john    password=password123");
  console.log("  Warehouse: username=wm.amara   password=password123");
  console.log("  Field:     username=fo.fatima  password=password123");
}

seed().catch(console.error).finally(() => process.exit(0));
