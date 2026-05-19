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

  // Build a district name → id lookup so we can reference any district safely
  const allDistricts: any[] = districts.length > 0 ? districts : await db.select().from(districtsTable);
  const dMap: Record<string, number> = {};
  for (const d of allDistricts) dMap[d.name] = d.id;
  // Fallback ordinal positions used only if the district was skipped by onConflictDoNothing
  const [bo, bombali, bonthe, kailahun, kambia, kenema, koinadugu, kono, moyamba, portloko, pujehun, tonkolili] = allDistricts;

  // Chiefdoms — all 14 Sierra Leone districts
  const chiefdoms = await db.insert(chiefdomsTable).values([
    // Bo (13)
    { name: "Bagbwe",          districtId: dMap["Bo"] ?? bo?.id },
    { name: "Badjia",          districtId: dMap["Bo"] ?? bo?.id },
    { name: "Boama",           districtId: dMap["Bo"] ?? bo?.id },
    { name: "Bumpe Ngao",      districtId: dMap["Bo"] ?? bo?.id },
    { name: "Gbo",             districtId: dMap["Bo"] ?? bo?.id },
    { name: "Jaiama Bongor",   districtId: dMap["Bo"] ?? bo?.id },
    { name: "Kakua",           districtId: dMap["Bo"] ?? bo?.id },
    { name: "Komboya",         districtId: dMap["Bo"] ?? bo?.id },
    { name: "Lugbu",           districtId: dMap["Bo"] ?? bo?.id },
    { name: "Niawa Lenga",     districtId: dMap["Bo"] ?? bo?.id },
    { name: "Selenga",         districtId: dMap["Bo"] ?? bo?.id },
    { name: "Tikonko",         districtId: dMap["Bo"] ?? bo?.id },
    { name: "Wunde",           districtId: dMap["Bo"] ?? bo?.id },
    // Bombali (12)
    { name: "Biriwa",                   districtId: dMap["Bombali"] ?? bombali?.id },
    { name: "Bombali Shebora",          districtId: dMap["Bombali"] ?? bombali?.id },
    { name: "Bombali Simiria",          districtId: dMap["Bombali"] ?? bombali?.id },
    { name: "Gbanti Kamaranka",         districtId: dMap["Bombali"] ?? bombali?.id },
    { name: "Gbendembu Ngowahun",       districtId: dMap["Bombali"] ?? bombali?.id },
    { name: "Libeisaygahun",            districtId: dMap["Bombali"] ?? bombali?.id },
    { name: "Magbaimba Ndowahun",       districtId: dMap["Bombali"] ?? bombali?.id },
    { name: "Makari Gbanti",            districtId: dMap["Bombali"] ?? bombali?.id },
    { name: "Ngowahun",                 districtId: dMap["Bombali"] ?? bombali?.id },
    { name: "Paki Masabong",            districtId: dMap["Bombali"] ?? bombali?.id },
    { name: "Sanda Loko",               districtId: dMap["Bombali"] ?? bombali?.id },
    { name: "Safroko Limba",            districtId: dMap["Bombali"] ?? bombali?.id },
    // Bonthe (11)
    { name: "Banta Mokele",   districtId: dMap["Bonthe"] ?? bonthe?.id },
    { name: "Dema",           districtId: dMap["Bonthe"] ?? bonthe?.id },
    { name: "Fakunya",        districtId: dMap["Bonthe"] ?? bonthe?.id },
    { name: "Jong",           districtId: dMap["Bonthe"] ?? bonthe?.id },
    { name: "Kpanda Kemoh",   districtId: dMap["Bonthe"] ?? bonthe?.id },
    { name: "Kwamebai Krim",  districtId: dMap["Bonthe"] ?? bonthe?.id },
    { name: "Nongoba Bullom", districtId: dMap["Bonthe"] ?? bonthe?.id },
    { name: "Ribbi",          districtId: dMap["Bonthe"] ?? bonthe?.id },
    { name: "Sogbeni",        districtId: dMap["Bonthe"] ?? bonthe?.id },
    { name: "Sittia",         districtId: dMap["Bonthe"] ?? bonthe?.id },
    { name: "Yawbeko",        districtId: dMap["Bonthe"] ?? bonthe?.id },
    // Kailahun (14)
    { name: "Dea",           districtId: dMap["Kailahun"] ?? kailahun?.id },
    { name: "Fiama",         districtId: dMap["Kailahun"] ?? kailahun?.id },
    { name: "Gaura",         districtId: dMap["Kailahun"] ?? kailahun?.id },
    { name: "Jawie",         districtId: dMap["Kailahun"] ?? kailahun?.id },
    { name: "Kissi Kama",    districtId: dMap["Kailahun"] ?? kailahun?.id },
    { name: "Kissi Teng",    districtId: dMap["Kailahun"] ?? kailahun?.id },
    { name: "Kissi Tongi",   districtId: dMap["Kailahun"] ?? kailahun?.id },
    { name: "Kpeje Bongre",  districtId: dMap["Kailahun"] ?? kailahun?.id },
    { name: "Kpeje West",    districtId: dMap["Kailahun"] ?? kailahun?.id },
    { name: "Luawa",         districtId: dMap["Kailahun"] ?? kailahun?.id },
    { name: "Malema",        districtId: dMap["Kailahun"] ?? kailahun?.id },
    { name: "Mandu",         districtId: dMap["Kailahun"] ?? kailahun?.id },
    { name: "Njaluahun",     districtId: dMap["Kailahun"] ?? kailahun?.id },
    { name: "Penguia",       districtId: dMap["Kailahun"] ?? kailahun?.id },
    // Kambia (6)
    { name: "Bramaia",      districtId: dMap["Kambia"] ?? kambia?.id },
    { name: "Gbinle Dixing",districtId: dMap["Kambia"] ?? kambia?.id },
    { name: "Magbema",      districtId: dMap["Kambia"] ?? kambia?.id },
    { name: "Mambolo",      districtId: dMap["Kambia"] ?? kambia?.id },
    { name: "Samu",         districtId: dMap["Kambia"] ?? kambia?.id },
    { name: "Tonko Limba",  districtId: dMap["Kambia"] ?? kambia?.id },
    // Kenema (15)
    { name: "Dama",          districtId: dMap["Kenema"] ?? kenema?.id },
    { name: "Dodo",          districtId: dMap["Kenema"] ?? kenema?.id },
    { name: "Gorama Mende",  districtId: dMap["Kenema"] ?? kenema?.id },
    { name: "Kandu Leppiama",districtId: dMap["Kenema"] ?? kenema?.id },
    { name: "Langrama",      districtId: dMap["Kenema"] ?? kenema?.id },
    { name: "Lower Bambara", districtId: dMap["Kenema"] ?? kenema?.id },
    { name: "Malegohun",     districtId: dMap["Kenema"] ?? kenema?.id },
    { name: "Niawa",         districtId: dMap["Kenema"] ?? kenema?.id },
    { name: "Nomo",          districtId: dMap["Kenema"] ?? kenema?.id },
    { name: "Nongowa",       districtId: dMap["Kenema"] ?? kenema?.id },
    { name: "Simbaru",       districtId: dMap["Kenema"] ?? kenema?.id },
    { name: "Small Bo",      districtId: dMap["Kenema"] ?? kenema?.id },
    { name: "Tunkia",        districtId: dMap["Kenema"] ?? kenema?.id },
    { name: "Wandor",        districtId: dMap["Kenema"] ?? kenema?.id },
    { name: "Nomo Kpaa",     districtId: dMap["Kenema"] ?? kenema?.id },
    // Koinadugu (11)
    { name: "Dembelia Sinkunia", districtId: dMap["Koinadugu"] ?? koinadugu?.id },
    { name: "Falaba",            districtId: dMap["Koinadugu"] ?? koinadugu?.id },
    { name: "Firia",             districtId: dMap["Koinadugu"] ?? koinadugu?.id },
    { name: "Gberia Timberi",    districtId: dMap["Koinadugu"] ?? koinadugu?.id },
    { name: "Kasunko",           districtId: dMap["Koinadugu"] ?? koinadugu?.id },
    { name: "Mongo",             districtId: dMap["Koinadugu"] ?? koinadugu?.id },
    { name: "Neya",              districtId: dMap["Koinadugu"] ?? koinadugu?.id },
    { name: "Nieni",             districtId: dMap["Koinadugu"] ?? koinadugu?.id },
    { name: "Sengbe",            districtId: dMap["Koinadugu"] ?? koinadugu?.id },
    { name: "Sulima",            districtId: dMap["Koinadugu"] ?? koinadugu?.id },
    { name: "Wara Wara Bafodia", districtId: dMap["Koinadugu"] ?? koinadugu?.id },
    // Kono (14)
    { name: "Gbane",        districtId: dMap["Kono"] ?? kono?.id },
    { name: "Gbane Kandor", districtId: dMap["Kono"] ?? kono?.id },
    { name: "Gbense",       districtId: dMap["Kono"] ?? kono?.id },
    { name: "Gorama Kono",  districtId: dMap["Kono"] ?? kono?.id },
    { name: "Kamara",       districtId: dMap["Kono"] ?? kono?.id },
    { name: "Lei",          districtId: dMap["Kono"] ?? kono?.id },
    { name: "Mafindor",     districtId: dMap["Kono"] ?? kono?.id },
    { name: "Nimikoro",     districtId: dMap["Kono"] ?? kono?.id },
    { name: "Nimiyama",     districtId: dMap["Kono"] ?? kono?.id },
    { name: "Sandor",       districtId: dMap["Kono"] ?? kono?.id },
    { name: "Soa",          districtId: dMap["Kono"] ?? kono?.id },
    { name: "Tankoro",      districtId: dMap["Kono"] ?? kono?.id },
    { name: "Toli",         districtId: dMap["Kono"] ?? kono?.id },
    { name: "Yone",         districtId: dMap["Kono"] ?? kono?.id },
    // Moyamba (14)
    { name: "Bagruwa",        districtId: dMap["Moyamba"] ?? moyamba?.id },
    { name: "Banta Mokele",   districtId: dMap["Moyamba"] ?? moyamba?.id },
    { name: "Bumpe",          districtId: dMap["Moyamba"] ?? moyamba?.id },
    { name: "Dasse",          districtId: dMap["Moyamba"] ?? moyamba?.id },
    { name: "Fakunya",        districtId: dMap["Moyamba"] ?? moyamba?.id },
    { name: "Kagboro",        districtId: dMap["Moyamba"] ?? moyamba?.id },
    { name: "Kaiyamba",       districtId: dMap["Moyamba"] ?? moyamba?.id },
    { name: "Kargboro",       districtId: dMap["Moyamba"] ?? moyamba?.id },
    { name: "Kongbora",       districtId: dMap["Moyamba"] ?? moyamba?.id },
    { name: "Ribbi",          districtId: dMap["Moyamba"] ?? moyamba?.id },
    { name: "Sittia",         districtId: dMap["Moyamba"] ?? moyamba?.id },
    { name: "Timdale",        districtId: dMap["Moyamba"] ?? moyamba?.id },
    { name: "TM Simbaru",     districtId: dMap["Moyamba"] ?? moyamba?.id },
    { name: "Valunia",        districtId: dMap["Moyamba"] ?? moyamba?.id },
    // Port Loko (12)
    { name: "Bureh Kasseh Maconteh", districtId: dMap["Port Loko"] ?? portloko?.id },
    { name: "Dibia",                  districtId: dMap["Port Loko"] ?? portloko?.id },
    { name: "Kafe Simira",            districtId: dMap["Port Loko"] ?? portloko?.id },
    { name: "Kaffu Bullom",           districtId: dMap["Port Loko"] ?? portloko?.id },
    { name: "Lokomasama",             districtId: dMap["Port Loko"] ?? portloko?.id },
    { name: "Maforki",                districtId: dMap["Port Loko"] ?? portloko?.id },
    { name: "Marampa",                districtId: dMap["Port Loko"] ?? portloko?.id },
    { name: "Masimera",               districtId: dMap["Port Loko"] ?? portloko?.id },
    { name: "Sanda Magbolontor",      districtId: dMap["Port Loko"] ?? portloko?.id },
    { name: "Sanda Tendaren",         districtId: dMap["Port Loko"] ?? portloko?.id },
    { name: "Sella Limba",            districtId: dMap["Port Loko"] ?? portloko?.id },
    { name: "Tinpot",                 districtId: dMap["Port Loko"] ?? portloko?.id },
    // Pujehun (12)
    { name: "Barri",         districtId: dMap["Pujehun"] ?? pujehun?.id },
    { name: "Gallinas Perri",districtId: dMap["Pujehun"] ?? pujehun?.id },
    { name: "Kpaka",         districtId: dMap["Pujehun"] ?? pujehun?.id },
    { name: "Malen",         districtId: dMap["Pujehun"] ?? pujehun?.id },
    { name: "Makpele",       districtId: dMap["Pujehun"] ?? pujehun?.id },
    { name: "Mano Sakrim",   districtId: dMap["Pujehun"] ?? pujehun?.id },
    { name: "Panga Kabonde", districtId: dMap["Pujehun"] ?? pujehun?.id },
    { name: "Panga Krim",    districtId: dMap["Pujehun"] ?? pujehun?.id },
    { name: "Penguia",       districtId: dMap["Pujehun"] ?? pujehun?.id },
    { name: "Soro Gbema",    districtId: dMap["Pujehun"] ?? pujehun?.id },
    { name: "Valunia",       districtId: dMap["Pujehun"] ?? pujehun?.id },
    { name: "Yakaju",        districtId: dMap["Pujehun"] ?? pujehun?.id },
    // Tonkolili (11)
    { name: "Gbonkolenken",     districtId: dMap["Tonkolili"] ?? tonkolili?.id },
    { name: "Kalansogoia",      districtId: dMap["Tonkolili"] ?? tonkolili?.id },
    { name: "Kholifa Mabang",   districtId: dMap["Tonkolili"] ?? tonkolili?.id },
    { name: "Kholifa Rowalla",  districtId: dMap["Tonkolili"] ?? tonkolili?.id },
    { name: "Kunike",           districtId: dMap["Tonkolili"] ?? tonkolili?.id },
    { name: "Kunike Barina",    districtId: dMap["Tonkolili"] ?? tonkolili?.id },
    { name: "Malal Mara",       districtId: dMap["Tonkolili"] ?? tonkolili?.id },
    { name: "Sambaia Bendugu",  districtId: dMap["Tonkolili"] ?? tonkolili?.id },
    { name: "Tane",             districtId: dMap["Tonkolili"] ?? tonkolili?.id },
    { name: "Yoni",             districtId: dMap["Tonkolili"] ?? tonkolili?.id },
    { name: "Yoni Bana",        districtId: dMap["Tonkolili"] ?? tonkolili?.id },
    // Western Area Rural (5)
    { name: "Waterloo Rural",   districtId: dMap["Western Area Rural"] ?? 13 },
    { name: "Lumley Rural",     districtId: dMap["Western Area Rural"] ?? 13 },
    { name: "Gloucester Rural", districtId: dMap["Western Area Rural"] ?? 13 },
    { name: "Mountain Rural",   districtId: dMap["Western Area Rural"] ?? 13 },
    { name: "Goderich Rural",   districtId: dMap["Western Area Rural"] ?? 13 },
    // Western Area Urban (3)
    { name: "Central Freetown", districtId: dMap["Western Area Urban"] ?? 14 },
    { name: "East End",         districtId: dMap["Western Area Urban"] ?? 14 },
    { name: "West End",         districtId: dMap["Western Area Urban"] ?? 14 },
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
