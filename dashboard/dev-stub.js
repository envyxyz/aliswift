// DEV-ONLY STUB: a fake Chrome extension runtime and storage, for working on the dashboard from disk or a
// static server without the extension. dashboard.html does not load it, and it never ships in the page.
// To use it: put <script src="dev-stub.js"></script> before the lib/shared.js script in a COPY of dashboard.html
// (do not commit that), open the copy, and pick a mode with ?stub=: no-sheet, signed-out, no-status-col,
// no-orders-tab, empty, cached, offline, products-error, orders-error, fail-set-status, fail-add-order,
// duplicate-order, fail-update-order, auth-null, limited, no-key, listing-error, listing-rate. ?latency=ms slows the replies.
// It also exports its sample data for test/dashboard.test.js. It does nothing inside the real extension.

(function () {
  if (typeof window === "undefined" && typeof module === "undefined") return;
  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
    return; // Real extension environment; do nothing.
  }

  const search = typeof window !== "undefined" && window.location ? window.location.search : "";
  const urlParams = new URLSearchParams(search);
  const stubMode = urlParams.get("stub") || "";
  const latency = typeof window !== "undefined" ? parseInt(urlParams.get("latency") ?? "180", 10) : 0;

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // Realistic sample products (~30 items across all statuses, variants, missing images, etc.)
  let sampleProducts = [
    {
      row: 3,
      sku: "SKU-01",
      title: "Stainless Steel Norse Viking Rune Ring Men Vintage Punk Odin Amulet Jewelry",
      link: "https://www.aliexpress.com/item/1005001111111111.html",
      price: 2.15,
      salePrice: 6.99,
      image: "https://ae01.alicdn.com/kf/S1a2b3c4d5e6f7g8.jpg",
      status: "Listed",
      statusShared: false,
      profit: 3.25,
      margin: 0.46,
    },
    {
      row: 4,
      sku: "SKU-02",
      title: "Vintage Gothic Snake Open Ring Adjustable Silver Color Punk Animal Finger Rings",
      link: "https://www.aliexpress.com/item/1005002222222222.html",
      price: 1.45,
      salePrice: 4.99,
      locked: ["salePrice"], // a sheet formula sets this one: the inspector shows it read-only
      image: "https://ae01.alicdn.com/kf/S2b3c4d5e6f7g8h9.jpg",
      status: "Listed",
      statusShared: false,
      profit: 2.1,
      margin: 0.42,
    },
    {
      row: 5,
      sku: "SKU-03",
      title: "Retro Dragon Claw Ring with Red Cubic Zirconia Evil Eye Punk Biker Men Jewelry",
      link: "https://www.aliexpress.com/item/1005003333333333.html",
      price: 3.8,
      salePrice: 8.99,
      image: "https://ae01.alicdn.com/kf/S3c4d5e6f7g8h9i0.jpg",
      status: "Listed",
      statusShared: false,
      profit: 2.85,
      margin: 0.32,
    },
    {
      row: 6,
      sku: "SKU-04",
      title: "Classic Tungsten Carbide Wedding Band 8mm Brushed Matte Finish Beveled Edge",
      link: "https://www.aliexpress.com/item/1005004444444444.html",
      price: 5.6,
      salePrice: 14.99,
      image: "https://ae01.alicdn.com/kf/S4d5e6f7g8h9i0j1.jpg",
      status: "Listed",
      statusShared: false,
      profit: 5.45,
      margin: 0.36,
    },
    {
      row: 7,
      sku: "SKU-05",
      title: "Titanium Steel Spinning Anxiety Ring Roman Numerals Fidget Band for Men Women",
      link: "https://www.aliexpress.com/item/1005005555555555.html",
      price: 1.9,
      salePrice: 5.49,
      image: "https://ae01.alicdn.com/kf/S5e6f7g8h9i0j1k2.jpg",
      status: "Draft",
      statusShared: false,
      profit: 1.95,
      margin: 0.35,
    },
    {
      row: 8,
      sku: "SKU-06",
      title: "Demon Eye Skull Ring Heavy Metal Rock Gothic Biker Finger Jewelry Gift",
      link: "https://www.aliexpress.com/item/1005006666666666.html",
      price: 4.2,
      salePrice: 9.99,
      image: "", // intentionally no image
      status: "Draft",
      statusShared: false,
      profit: 3.15,
      margin: 0.31,
    },
    {
      row: 9,
      sku: "SKU-07",
      title: "Bohemian Turquoise Stone Feather Ring Retro Adjustable Leaf Statement Rings",
      link: "https://www.aliexpress.com/item/1005007777777777.html",
      price: 1.1,
      salePrice: 3.99,
      image: "https://ae01.alicdn.com/kf/S7g8h9i0j1k2l3m4.jpg",
      status: "Draft",
      statusShared: false,
      profit: 1.65,
      margin: 0.41,
    },
    {
      row: 10,
      sku: "SKU-08",
      title: "Viking Vegvisir Compass Ring Norse Mythology Rune Talisman Protection Amulet",
      link: "https://www.aliexpress.com/item/1005008888888888.html",
      price: 2.8,
      salePrice: 7.99,
      image: "https://ae01.alicdn.com/kf/S8h9i0j1k2l3m4n5.jpg",
      status: "Draft",
      statusShared: false,
      profit: 2.95,
      margin: 0.37,
    },
    {
      row: 11,
      sku: "SKU-09",
      title: "Signet Ring Gold Color Stainless Steel Blank Plain Oval Top Polished Biker Ring",
      link: "https://www.aliexpress.com/item/1005009999999999.html",
      price: 3.1,
      salePrice: 8.49,
      image: "https://ae01.alicdn.com/kf/S9i0j1k2l3m4n5o6.jpg",
      status: "Not Listed",
      statusShared: false,
      profit: 3.05,
      margin: 0.36,
    },
    {
      row: 12,
      sku: "SKU-10",
      title: "Simple 4mm Slim Titanium Band Ring High Polish Comfort Fit Wedding Jewelry",
      link: "https://www.aliexpress.com/item/1005010000000000.html",
      price: 0.95,
      salePrice: 3.49,
      image: "", // no image
      status: "Not Listed",
      statusShared: false,
      profit: 1.45,
      margin: 0.41,
    },
    {
      row: 13,
      sku: "SKU-11",
      title: "Celtic Knot Dragon Inlay Carbon Fiber Ring Glow in the Dark Night Luminous Band",
      link: "https://www.aliexpress.com/item/1005011111111111.html",
      price: 2.7,
      salePrice: 7.49,
      image: "https://ae01.alicdn.com/kf/S1b0c1d2e3f4g5h6.jpg",
      status: "Not Listed",
      statusShared: false,
      profit: 2.65,
      margin: 0.35,
    },
    {
      row: 14,
      sku: "SKU-12",
      title: "Antique Silver Tree of Life Ring Yggdrasil Mythology World Tree Signet Jewelry",
      link: "https://www.aliexpress.com/item/1005012222222222.html",
      price: 2.3,
      salePrice: 6.99,
      image: "https://localhost.invalid/broken.jpg",
      status: "Not Listed",
      statusShared: false,
      profit: 2.75,
      margin: 0.39,
    },
    {
      row: 15,
      sku: "SKU-13",
      title: "Heavy Stainless Steel Masonic Ring Freemason Compass Freemasonry Master Mason",
      link: "https://www.aliexpress.com/item/1005013333333333.html",
      price: 4.5,
      salePrice: 11.99,
      image: "https://ae01.alicdn.com/kf/S3d2e3f4g5h6i7j8.jpg",
      status: "Discontinued",
      statusShared: false,
      profit: 4.25,
      margin: 0.35,
    },
    {
      row: 16,
      sku: "SKU-14",
      title: "Octopus Tentacle Sea Monster Ring Adjustable Deep Ocean Kraken Finger Wrap",
      link: "https://www.aliexpress.com/item/1005014444444444.html",
      price: 1.8,
      salePrice: 5.99,
      image: "https://ae01.alicdn.com/kf/S4e3f4g5h6i7j8k9.jpg",
      status: "Discontinued",
      statusShared: false,
      profit: 2.45,
      margin: 0.41,
    },
    {
      row: 17,
      sku: "SKU-15",
      title: "Broken link test product with non-standard text in link column",
      link: "not-a-valid-https-link",
      price: 3.0,
      salePrice: 6.5,
      image: "",
      status: "Discontinued",
      statusShared: false,
      profit: 1.5,
      margin: 0.23,
    },
    {
      row: 18,
      sku: "SKU-16",
      title: "Wolf Head Viking Ring Fenrir Norse Beast Totem Biker Nordic Animal Jewelry",
      link: "https://www.aliexpress.com/item/1005016666666666.html",
      price: 3.4,
      salePrice: 8.99,
      image: "https://ae01.alicdn.com/kf/S6g5h6i7j8k9l0m1.jpg",
      status: "Listed",
      statusShared: false,
      profit: 3.1,
      margin: 0.34,
    },
    // Merged variant group (rows 19-21) sharing status "Listed" and statusShared = true
    {
      row: 19,
      sku: "SKU-17-1",
      title: "Natural Agate Stone Men Ring 925 Silver Color Signet Oval Gemstone - Black Onyx",
      link: "https://www.aliexpress.com/item/1005017777777777.html",
      price: 6.8,
      salePrice: 15.99,
      image: "https://ae01.alicdn.com/kf/S7h6i7j8k9l0m1n2.jpg",
      status: "Listed",
      statusShared: true,
      profit: 4.8,
      margin: 0.3,
    },
    {
      row: 20,
      sku: "SKU-17-2",
      title: "Natural Agate Stone Men Ring 925 Silver Color Signet Oval Gemstone - Red Carnelian",
      link: "https://www.aliexpress.com/item/1005017777777777.html",
      price: 6.8,
      salePrice: 15.99,
      image: "https://ae01.alicdn.com/kf/S8i7j8k9l0m1n2o3.jpg",
      status: "Listed",
      statusShared: true,
      profit: 4.8,
      margin: 0.3,
    },
    {
      row: 21,
      sku: "SKU-17-3",
      title: "Natural Agate Stone Men Ring 925 Silver Color Signet Oval Gemstone - Tiger Eye",
      link: "https://www.aliexpress.com/item/1005017777777777.html",
      price: 6.8,
      salePrice: 15.99,
      image: "https://ae01.alicdn.com/kf/S9j8k9l0m1n2o3p4.jpg",
      status: "Listed",
      statusShared: true,
      profit: 4.8,
      margin: 0.3,
    },
    {
      row: 22,
      sku: "SKU-18",
      title: "Skull Wings Biker Ring Men Women Gothic High Polish Heavy Metal Band Jewelry",
      link: "https://www.aliexpress.com/item/1005018888888888.html",
      price: 5.6,
      salePrice: 9.59,
      image: "https://ae01.alicdn.com/kf/S0k9l0m1n2o3p4q5.jpg",
      status: "Draft",
      statusShared: false,
      profit: 2.11,
      margin: 0.22, // amber (15-25%)
    },
    {
      row: 23,
      sku: "SKU-19",
      title: "Low Margin Wholesale Ring Special Deal Promotional Clearance Ring",
      link: "https://www.aliexpress.com/item/1005019999999999.html",
      price: 7.5,
      salePrice: 8.5,
      image: "https://ae01.alicdn.com/kf/S1l0m1n2o3p4q5r6.jpg",
      status: "Draft",
      statusShared: false,
      profit: 0.35,
      margin: 0.04, // red (<15%)
    },
    {
      row: 24,
      sku: "SKU-20",
      title: "Negative Profit Return Experiment Sample Ring Problem Product",
      link: "https://www.aliexpress.com/item/1005020000000000.html",
      price: 12.0,
      salePrice: 10.99,
      image: "",
      status: "Draft",
      statusShared: false,
      profit: -2.4,
      margin: -0.22, // red (negative)
    },
    {
      row: 25,
      sku: "SKU-21",
      title: "Fair Margin 18% Amber Threshold Test Product Celtic Cross Band Ring",
      link: "https://www.aliexpress.com/item/1005021111111111.html",
      price: 4.0,
      salePrice: 6.99,
      image: "https://ae01.alicdn.com/kf/S2m1n2o3p4q5r6s7.jpg",
      status: "Listed",
      statusShared: false,
      profit: 1.25,
      margin: 0.18, // amber (18%)
    },
    {
      row: 26,
      sku: "SKU-22",
      title: "Fair Margin Exactly 25% Upper Threshold Green Edge Test Signet Ring",
      link: "https://www.aliexpress.com/item/1005022222222222.html",
      price: 3.0,
      salePrice: 6.0,
      image: "https://ae01.alicdn.com/kf/S3n2o3p4q5r6s7t8.jpg",
      status: "Listed",
      statusShared: false,
      profit: 1.5,
      margin: 0.25, // amber (25% inclusive)
    },
    {
      row: 27,
      sku: "SKU-23",
      title: "Super High Margin 55% Green Zone Luxury Tungsten Carbide Ring with Rose Gold Groove",
      link: "https://www.aliexpress.com/item/1005023333333333.html",
      price: 4.5,
      salePrice: 18.99,
      image: "https://ae01.alicdn.com/kf/S4o3p4q5r6s7t8u9.jpg",
      status: "Listed",
      statusShared: false,
      profit: 10.45,
      margin: 0.55, // green (>25%)
    },
    {
      row: 28,
      sku: "SKU-24",
      title: "Punk Rock Stainless Steel Spinner Chain Ring Rotatable Anxiety Relief Band for Men",
      link: "https://www.aliexpress.com/item/1005024444444444.html",
      price: 2.2,
      salePrice: 6.49,
      image: "https://ae01.alicdn.com/kf/S5p4q5r6s7t8u9v0.jpg",
      status: "Not Listed",
      statusShared: false,
      profit: 2.75,
      margin: 0.42,
    },
    {
      row: 29,
      sku: "SKU-25",
      title: "Gothic Raven Skull Bird Claw Talisman Ring Nordic Pagan Odin Huginn Muninn Crow Ring",
      link: "https://www.aliexpress.com/item/1005025555555555.html",
      price: 3.1,
      salePrice: 8.99,
      image: "https://ae01.alicdn.com/kf/S6q5r6s7t8u9v0w1.jpg",
      status: "Not Listed",
      statusShared: false,
      profit: 3.8,
      margin: 0.42,
    },
    {
      row: 30,
      sku: "SKU-26",
      title: "Extremely Long Product Name Designed Explicitly to Verify the Two Line Clamp Requirement in Card View Layout Test Men Ring",
      link: "https://www.aliexpress.com/item/1005026666666666.html",
      price: 2.5,
      salePrice: 7.25,
      image: "https://ae01.alicdn.com/kf/S7r6s7t8u9v0w1x2.jpg",
      status: "Draft",
      statusShared: false,
      profit: 2.9,
      margin: 0.4,
    },
    {
      row: 31,
      sku: "SKU-27",
      title: "Minimalist Geometric Hexagon Ring Brushed Matte Surface Stainless Steel Urban Architecture Jewelry",
      link: "https://www.aliexpress.com/item/1005027777777777.html",
      price: 1.85,
      salePrice: 5.49,
      image: "https://ae01.alicdn.com/kf/S8s7t8u9v0w1x2y3.jpg",
      status: "Discontinued",
      statusShared: false,
      profit: 2.15,
      margin: 0.39,
    },
    {
      row: 32,
      sku: "SKU-28",
      title: "Vintage Carved Floral Pattern Band Ring Antique Silver Finish Victorian Style Finger Ring",
      link: "https://www.aliexpress.com/item/1005028888888888.html",
      price: 1.6,
      salePrice: 4.99,
      image: "https://ae01.alicdn.com/kf/S9t8u9v0w1x2y3z4.jpg",
      status: "Discontinued",
      statusShared: false,
      profit: 2.1,
      margin: 0.42,
    },
  ];

  // Realistic sample orders (~15 orders across all statuses)
  let sampleOrders = [
    {
      row: 2,
      orderNumber: "12-34567-89011",
      sku: "SKU-01",
      product: "Stainless Steel Norse Viking Rune Ring",
      date: "2026-10-10",
      qty: 1,
      sell: 6.99,
      cost: 2.15,
      profit: 3.25,
      status: "Pending",
      tracking: "",
      notes: "First time buyer, requested swift dispatch",
    },
    {
      row: 3,
      orderNumber: "12-34567-89011",
      sku: "SKU-18",
      product: "Skull Wings Biker Ring Men Women Gothic",
      date: "2026-10-09",
      qty: 2,
      sell: 19.18,
      cost: 11.2,
      profit: 4.22,
      status: "Pending",
      tracking: "",
      notes: "Size 10 and Size 11 combined",
    },
    {
      row: 4,
      orderNumber: "12-34567-89013",
      sku: "SKU-04",
      product: "Classic Tungsten Carbide Wedding Band 8mm",
      date: "2026-10-08",
      qty: 1,
      sell: 14.99,
      cost: 5.6,
      profit: 5.45,
      status: "Ordered",
      tracking: "LP0054321987GB",
      notes: "Supplier order placed on AliExpress",
    },
    {
      row: 5,
      orderNumber: "12-34567-89014",
      sku: "SKU-02",
      product: "Vintage Gothic Snake Open Ring Adjustable",
      date: "2026-10-07",
      qty: 3,
      sell: 14.97,
      cost: 4.35,
      profit: 6.3,
      status: "Ordered",
      tracking: "LP0054321988GB",
      notes: "Gift packaging requested",
    },
    {
      row: 6,
      orderNumber: "12-34567-89015",
      sku: "SKU-03",
      product: "Retro Dragon Claw Ring with Red CZ",
      date: "2026-10-06",
      qty: 1,
      sell: 8.99,
      cost: 3.8,
      profit: 2.85,
      status: "Shipped",
      tracking: "RR123456789GB",
      notes: "Royal Mail Tracked 48",
    },
    {
      row: 7,
      orderNumber: "12-34567-89016",
      sku: "SKU-16",
      product: "Wolf Head Viking Ring Fenrir Totem",
      date: "2026-10-05",
      qty: 1,
      sell: 8.99,
      cost: 3.4,
      profit: 3.1,
      status: "Shipped",
      tracking: "RR987654321GB",
      notes: "Dispatched on time",
    },
    {
      row: 8,
      orderNumber: "12-34567-89017",
      sku: "SKU-17-1",
      product: "Natural Agate Stone Men Ring - Black Onyx",
      date: "2026-10-04",
      qty: 1,
      sell: 15.99,
      cost: 6.8,
      profit: 4.8,
      status: "Delivered",
      tracking: "RR456789123GB",
      notes: "Buyer left positive 5-star feedback",
    },
    {
      row: 9,
      orderNumber: "12-34567-89018",
      sku: "SKU-05",
      product: "Titanium Steel Spinning Anxiety Ring",
      date: "2026-10-03",
      qty: 2,
      sell: 10.98,
      cost: 3.8,
      profit: 3.9,
      status: "Delivered",
      tracking: "RR789123456GB",
      notes: "",
    },
    {
      row: 10,
      orderNumber: "12-34567-89019",
      sku: "SKU-08",
      product: "Viking Vegvisir Compass Ring",
      date: "2026-10-02",
      qty: 1,
      sell: 7.99,
      cost: 2.8,
      profit: 2.95,
      status: "Delivered",
      tracking: "RR321654987GB",
      notes: "",
    },
    {
      row: 11,
      orderNumber: "12-34567-89020",
      sku: "SKU-23",
      product: "Super High Margin Luxury Tungsten Ring",
      date: "2026-10-01",
      qty: 1,
      sell: 18.99,
      cost: 4.5,
      profit: 10.45,
      status: "Delivered",
      tracking: "RR654987321GB",
      notes: "Express delivery option selected",
    },
    {
      row: 12,
      orderNumber: "12-34567-89021",
      sku: "SKU-07",
      product: "Bohemian Turquoise Stone Feather Ring",
      date: "2026-09-30",
      qty: 1,
      sell: 3.99,
      cost: 1.1,
      profit: 1.65,
      status: "Cancelled",
      tracking: "",
      notes: "Buyer changed their mind before dispatch",
    },
    {
      row: 13,
      orderNumber: "12-34567-89022",
      sku: "SKU-14",
      product: "Octopus Tentacle Sea Monster Ring",
      date: "2026-09-28",
      qty: 1,
      sell: 5.99,
      cost: 1.8,
      profit: 2.45,
      status: "Cancelled",
      tracking: "",
      notes: "Out of stock on supplier store, cancelled and refunded",
    },
    {
      row: 14,
      orderNumber: "12-34567-89023",
      sku: "SKU-20",
      product: "Negative Profit Return Experiment Sample Ring",
      date: "2026-09-25",
      qty: 1,
      sell: 10.99,
      cost: 12.0,
      profit: -2.4,
      status: "Disputed",
      tracking: "RR112233445GB",
      notes: "Item arrived damaged case opened on eBay",
    },
    {
      row: 15,
      orderNumber: "12-34567-89024",
      sku: "SKU-19",
      product: "Low Margin Wholesale Ring Special Deal",
      date: "2026-09-22",
      qty: 5,
      sell: 42.5,
      cost: 37.5,
      profit: 1.75,
      status: "Delivered",
      tracking: "RR998877665GB",
      notes: "Bulk order",
    },
    {
      row: 16,
      orderNumber: "12-34567-89025",
      sku: "SKU-11",
      product: "Celtic Knot Dragon Inlay Carbon Fiber Ring",
      date: "2026-09-18",
      qty: 1,
      sell: 7.49,
      cost: 2.7,
      profit: 2.65,
      status: "Delivered",
      tracking: "RR554433221GB",
      notes: "",
    },
  ];

  // Configured sample sheets
  const defaultSheets = [
    {
      id: "sheet-uk-primary",
      name: "eBay UK Store (Template)",
      region: "UK",
      sheetTab: "Inventory",
      startRow: 3,
      skuCol: "A",
      keywordsCol: "B",
      linkCol: "C",
      priceCol: "D",
      salePriceCol: "E",
      statusCol: "M",
      imageCol: "O",
      profitCol: "J",
      marginCol: "L",
      skuPrefix: "SKU-",
      oTab: "Orders",
      oRow: 2,
      oCols: {
        no: "A",
        sku: "B",
        date: "D",
        qty: "E",
        sell: "F",
        cost: "G",
        profit: "H",
        status: "J",
        track: "K",
        notes: "L",
      },
    },
    {
      id: "sheet-us-simple",
      name: "eBay US Store (No Orders)",
      region: "US",
      sheetTab: "Sheet1",
      startRow: 2,
      skuCol: "A",
      keywordsCol: "B",
      linkCol: "C",
      priceCol: "D",
      salePriceCol: "E",
      statusCol: "M",
      imageCol: "",
      profitCol: "",
      marginCol: "",
      skuPrefix: "US-",
      oTab: "", // orders not set up
      oRow: 2,
      oCols: {},
    },
    {
      id: "sheet-no-status",
      name: "Legacy Sheet (No Status Col)",
      region: "UK",
      sheetTab: "Inventory",
      startRow: 3,
      skuCol: "A",
      keywordsCol: "B",
      linkCol: "C",
      priceCol: "D",
      salePriceCol: "E",
      statusCol: "", // no status column
      imageCol: "O",
      profitCol: "J",
      marginCol: "L",
      skuPrefix: "SKU-",
      oTab: "Orders",
      oRow: 2,
      oCols: { no: "A", sku: "B", date: "D", qty: "E", sell: "F", cost: "G", profit: "H", status: "J", track: "K", notes: "L" },
    },
  ];

  // Apply stub overrides from URL query
  let activeSheets = [...defaultSheets];
  let activeSheetId = "sheet-uk-primary";
  let signedIn = true;

  if (stubMode === "no-sheet") {
    activeSheets = [];
    activeSheetId = "";
  } else if (stubMode === "signed-out") {
    signedIn = false;
  } else if (stubMode === "no-status-col") {
    activeSheetId = "sheet-no-status";
  } else if (stubMode === "no-orders-tab") {
    activeSheetId = "sheet-us-simple";
  } else if (stubMode === "empty") {
    sampleProducts = [];
    sampleOrders = [];
  }

  // Pre-seed storage
  const syncStore = {
    sheets: activeSheets,
    activeSheetId: activeSheetId,
  };

  // A kept listing, in the shape background.js stores it (listing:<AliExpress item number>).
  const fakeListing = (title) => ({
    listing: {
      title: String(title).slice(0, 80),
      description: "Material & features\n- Solid stainless steel with carved runes\n- Comfortable fit\n\nSize details\nNot specified\n\nPerfect for\n- Gifts and everyday wear\n\nShipping\nPosted after the order, with tracking.",
      itemSpecifics: [
        { name: "Brand", value: "Unbranded" },
        { name: "Material", value: "Stainless steel" },
        { name: "Color", value: "Silver" },
      ],
      variants: ["Size 7", "Size 8", "Size 9"],
      categoryHint: "Jewellery > Rings",
      analysis: { score: 82, summary: "Complete and clear. Check the size chart.", redFlags: ["Size chart is missing", "Rune meaning not proven"] },
    },
    limited: false,
    model: "gemini-3.8-flash",
    createdAt: Date.now() - 600000,
    warnings: [],
  });
  const localStore = {
    "listing:1005001111111111": fakeListing("Stainless Steel Norse Viking Rune Ring Men Vintage Punk"),
  };
  if (stubMode === "cached" || stubMode === "offline") {
    localStore["cache:sheet-uk-primary"] = {
      at: Date.now() - 3600000, // 1 hour ago
      products: sampleProducts.slice(0, 10),
    };
  }

  // Create mock chrome object
  const mockChrome = {
    runtime: {
      openOptionsPage: function (cb) {
        if (typeof window !== "undefined") window.open("../options/options.html", "_blank");
        if (cb) cb();
      },
      sendMessage: async function (msg, cb) {
        await delay(latency);

        let res = { success: true };

        try {
          if (stubMode === "offline" && (msg.action === "listProducts" || msg.action === "listOrders")) {
            res = { success: false, error: "Failed to fetch: NetworkError when attempting to fetch resource." };
          } else if ((stubMode === "signed-out" || !signedIn) && !["authState", "signIn"].includes(msg.action) && msg.sheetId !== "local") {
            res = { success: false, code: "signin", error: "Signed out." }; // the library needs no sign-in
          } else if (msg.action === "authState") {
            res = { success: true, signedIn: stubMode === "auth-null" ? null : signedIn }; // null: offline, couldn't tell
          } else if (msg.action === "signIn") {
            signedIn = true;
            res = { success: true, signedIn: true };
          } else if (msg.action === "signOut") {
            signedIn = false;
            res = { success: true };
          } else if (msg.action === "listProducts") {
            if (stubMode === "products-error") {
              res = { success: false, error: "Google Sheets API: Rate limit exceeded or sheet inaccessible." };
            } else if (msg.sheetId === "local") {
              res = {
                success: true,
                products: sampleProducts.slice(0, 5).map((p, idx) => ({
                  ...p,
                  row: idx + 1,
                  profit: null,
                  margin: null,
                  statusShared: false,
                })),
              };
            } else {
              res = { success: true, products: [...sampleProducts] };
            }
          } else if (msg.action === "setStatus") {
            if (stubMode === "fail-set-status") {
              res = { success: false, error: "Could not write status cell: Permission denied on Google Sheet." };
            } else {
              const { key, status } = msg;
              const prod = sampleProducts.find((p) => (key?.sku && p.sku === key.sku) || (key?.row && p.row === key.row));
              if (prod) prod.status = status;
              res = { success: true };
            }
          } else if (msg.action === "priceLocks") {
            res = { success: true, locked: sampleProducts.find((p) => p.row === msg.row)?.locked ?? [] };
          } else if (msg.action === "updateProduct") {
            const { key, price, salePrice } = msg;
            const prod = sampleProducts.find((p) => (key?.sku && p.sku === key.sku) || (key?.row && p.row === key.row));
            if (!prod) res = { success: false, code: "gone", error: "That product isn't in the sheet any more." };
            else if ((prod.locked ?? []).some((f) => msg[f] !== undefined)) res = { success: false, code: "formula", error: "That price is a formula in your sheet." };
            else {
              if (price !== undefined) prod.price = Number(price);
              if (salePrice !== undefined) prod.salePrice = Number(salePrice);
              res = { success: true, ...(price !== undefined && { price: prod.price }), ...(salePrice !== undefined && { salePrice: prod.salePrice }) };
            }
          } else if (msg.action === "listOrders") {
            if (stubMode === "orders-error") {
              res = { success: false, error: "Google Sheets API: Orders tab not found in the spreadsheet." };
            } else {
              res = { success: true, orders: [...sampleOrders] };
            }
          } else if (msg.action === "addOrder") {
            if (stubMode === "fail-add-order") {
              res = { success: false, error: "Could not append row to Orders tab: Sheet quota reached." };
            } else if (
              stubMode === "duplicate-order" ||
              sampleOrders.some((o) => o.orderNumber === msg.order?.orderNumber && o.sku === msg.order?.sku)
            ) {
              res = { success: false, code: "duplicate", error: "Duplicate order number" };
            } else {
              const newOrder = {
                row: sampleOrders.length + 2,
                orderNumber: msg.order.orderNumber,
                sku: msg.order.sku,
                product: sampleProducts.find((p) => p.sku === msg.order.sku)?.title || msg.order.sku,
                date: msg.order.date,
                qty: Number(msg.order.qty) || 1,
                sell: Number(msg.order.sell) || 0,
                cost: 0,
                profit: 0,
                status: "Pending",
                tracking: "",
                notes: msg.order.notes || "",
              };
              sampleOrders.unshift(newOrder);
              res = { success: true };
            }
          } else if (msg.action === "updateOrder") {
            if (stubMode === "fail-update-order") {
              res = { success: false, error: "Failed to update row: Sheet cell is locked." };
            } else {
              const ord = sampleOrders.find((o) => {
                if (msg.key?.row) return o.row === msg.key.row;
                if (msg.key?.sku) return o.orderNumber === msg.orderNumber && o.sku === msg.key.sku;
                return o.orderNumber === msg.orderNumber;
              });
              if (ord && msg.patch) {
                if (msg.patch.status !== undefined) ord.status = msg.patch.status;
                if (msg.patch.tracking !== undefined) ord.tracking = msg.patch.tracking;
                if (msg.patch.notes !== undefined) ord.notes = msg.patch.notes;
              }
              res = { success: true };
            }
          } else if (msg.action === "generateListing") {
            const key = /\/item\/(\d{6,})/.exec(msg.product?.link ?? "")?.[1] || "item";
            const slot = `listing:${key}`;
            if (stubMode === "no-key") {
              res = { success: false, code: "nokey", error: "Add a Gemini key in the AI tab." };
            } else if (localStore[slot] && !msg.force) {
              res = { success: true, key, cached: true, ...localStore[slot] };
            } else if (stubMode === "listing-error") {
              res = { success: false, code: "bad-output", error: "Gemini's answer had no usable title and description. Try again." };
            } else if (stubMode === "listing-rate") {
              res = { success: false, code: "rate", error: "Resource has been exhausted." };
            } else {
              await delay(latency ? 1200 : 0); // a listing takes a while
              localStore[slot] = { ...fakeListing(msg.product?.title || key), limited: stubMode === "limited", createdAt: Date.now() };
              res = { success: true, key, ...localStore[slot] };
            }
          } else if (msg.action === "saveListing") {
            const slot = `listing:${msg.key}`;
            if (!localStore[slot]) {
              res = { success: false, error: "That product has no saved listing. Create one first." };
            } else {
              const listing = { ...localStore[slot].listing };
              if (typeof msg.title === "string") listing.title = msg.title.slice(0, 80);
              if (typeof msg.description === "string") listing.description = msg.description;
              localStore[slot] = { ...localStore[slot], listing, edited: true };
              res = { success: true, listing };
            }
          } else if (msg.action === "moveLocal") {
            res = { success: true, moved: 5, skipped: 0, needRate: 0 };
          } else if (msg.action === "rate") {
            res = { success: true, rate: 374.37 };
          } else {
            res = { success: true };
          }
        } catch (err) {
          res = { success: false, error: err.message };
        }

        if (cb) cb(res);
        return res;
      },
    },
    storage: {
      onChanged: { addListener() {} },
      sync: {
        get: async function (keys, cb) {
          await delay(latency / 2);
          const result = {};
          if (!keys) {
            Object.assign(result, syncStore);
          } else if (typeof keys === "string") {
            result[keys] = syncStore[keys];
          } else if (Array.isArray(keys)) {
            for (const k of keys) result[k] = syncStore[k];
          } else if (typeof keys === "object") {
            for (const [k, def] of Object.entries(keys)) {
              result[k] = syncStore[k] !== undefined ? syncStore[k] : def;
            }
          }
          if (cb) cb(result);
          return result;
        },
        set: async function (items, cb) {
          await delay(latency / 2);
          Object.assign(syncStore, items);
          if (cb) cb();
        },
      },
      local: {
        get: async function (keys, cb) {
          await delay(latency / 2);
          const result = {};
          if (!keys) {
            Object.assign(result, localStore);
          } else if (typeof keys === "string") {
            result[keys] = localStore[keys];
          } else if (Array.isArray(keys)) {
            for (const k of keys) result[k] = localStore[k];
          } else if (typeof keys === "object") {
            for (const [k, def] of Object.entries(keys)) {
              result[k] = localStore[k] !== undefined ? localStore[k] : def;
            }
          }
          if (cb) cb(result);
          return result;
        },
        set: async function (items, cb) {
          await delay(latency / 2);
          Object.assign(localStore, items);
          if (cb) cb();
        },
      },
    },
  };

  if (typeof window !== "undefined") {
    window.chrome = mockChrome;
    console.info(
      `[dev-stub] Activated AliSwift dev stub! Mode: "${stubMode || "default"}". Latency: ${latency}ms.`
    );
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      mockChrome,
      sampleProducts,
      sampleOrders,
      defaultSheets,
    };
  }
})();
