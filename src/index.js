const sketch = require("sketch");
const { DataSupplier } = sketch;
const util = require("util");
const currencyFormatter = require("currency-formatter");
const fs = require("@skpm/fs");

let key;

/* TODO:
  - Organize File
  - has a original file to copy and replace
  - BUG: new sync content don't find the run (need to reset the sketch) 
*/

Array.prototype.randomElement = function() {
  return this[Math.floor(Math.random() * this.length)];
};

var pluginIdentifier = "com.zehfernandes.dataspreadsheet";

function getPreferences(key) {
  var userDefaults = NSUserDefaults.standardUserDefaults();
  if (!userDefaults.dictionaryForKey(pluginIdentifier)) {
    var defaultPreferences = NSMutableDictionary.alloc().init();
    // Your default preferences
    //defaultPreferences.setObject_forKey("value1", "key1");

    userDefaults.setObject_forKey(defaultPreferences, pluginIdentifier);
    userDefaults.synchronize();
  }
  return userDefaults.dictionaryForKey(pluginIdentifier).objectForKey(key);
}

function setPreferences(key, value) {
  var userDefaults = NSUserDefaults.standardUserDefaults();
  if (!userDefaults.dictionaryForKey(pluginIdentifier)) {
    var preferences = NSMutableDictionary.alloc().init();
  } else {
    var preferences = NSMutableDictionary.dictionaryWithDictionary(
      userDefaults.dictionaryForKey(pluginIdentifier)
    );
  }
  preferences.setObject_forKey(value, key);
  userDefaults.setObject_forKey(preferences, pluginIdentifier);
  userDefaults.synchronize();
}

function parseData(data) {
  var values = {};

  data.feed.entry.forEach(function(entry) {
    Object.keys(entry)
      .filter(function(key) {
        return key.indexOf("gsx$") == 0;
      })
      .forEach(function(key) {
        var objKey = entry["gsx$key"]["$t"];

        if (!values.hasOwnProperty(objKey)) {
          values[objKey] = [];
        } else {
          values[objKey].push(entry[key]["$t"]);
        }
      });
  });
  return values;
}

function fetchValuesForPage(sheetID, pageNumber) {
  let queryURL =
    "https://spreadsheets.google.com/feeds/list/" +
    sheetID +
    "/" +
    pageNumber +
    "/public/values?alt=json";

  var request = NSMutableURLRequest.new();
  request.setHTTPMethod("GET");
  request.setURL(NSURL.URLWithString(queryURL));

  var error = NSError.new();
  var responseCode = null;
  var response = NSURLConnection.sendSynchronousRequest_returningResponse_error(
    request,
    responseCode,
    error
  );

  var dataString = NSString.alloc().initWithData_encoding(
    response,
    NSUTF8StringEncoding
  );

  try {
    var data = JSON.parse(dataString);
    return parseData(data);
  } catch (e) {
    //sketch.UI.message("Failed to process the document data correctly");
    console.log(e);
    return null;
  }
}

function getScriptFolder(context) {
  const parts = context.scriptPath.split("/");
  parts.pop();
  return parts.join("/");
}

function cacheJSON(path) {
  let sheet = getPreferences("sheetID");
  const jsonFile = fetchValuesForPage(sheet, 1);
  fs.writeFileSync(`${path}/data.json`, JSON.stringify(jsonFile, null, 2));
  return jsonFile;
}

function editJSFile(path, headers) {
  console.log("---- JS FILE ----");
  let jsFile = fs.readFileSync(`${path}/index.js`, "utf8");

  headers.map(h => {
    jsFile += `\nthat['Supply${h}'] = __skpm_run.bind(this, 'onSupplyData');`;
  });

  fs.writeFileSync(`${path}//index.js`, jsFile, "utf-8");
}

function editManifestJSON(path, headers) {
  console.log("---- MANIFEST ----");
  const manifestJSON = JSON.parse(
    fs.readFileSync(`${path}/manifest.json`, "utf8")
  );

  headers.map(h => {
    manifestJSON.commands[0].handlers.actions[`Supply${h}`] = "onSupplyData";
  });

  fs.writeFileSync(
    `${path}/manifest.json`,
    JSON.stringify(manifestJSON, null, 2)
  );
}

function validateURL(url) {
  if (url === "") {
    return null;
  }

  var regex = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/g;
  var matches = regex.exec(url);
  return matches && matches.length > 1 ? matches[1] : null;
}

function syncContent() {
  let sheet = getPreferences("sheetID");
  if (!sheet) {
    linkSpreadsheet();
    return;
  }

  key =
    "_" +
    Math.random()
      .toString(36)
      .substr(2, 9);

  const path = getScriptFolder(context);
  const content = cacheJSON(path);
  const headers = Object.keys(content);

  editManifestJSON(path, headers);
  editJSFile(path, headers);

  headers.map(h => {
    console.log(h);
    DataSupplier.registerDataSupplier(
      "public.text",
      `Random ${h}`,
      `Supply${h}`
    );
  });
}

export function onStartup(context) {
  console.log("START");
  syncContent();
}

export function onShutdown() {
  //DataSupplier.deregisterDataSuppliers();
}

export function onSupplyData(context) {
  const dataRow = AppController.sharedInstance()
    .dataSupplierManager()
    .replyContexts()
    [context.data.key].dataFeed.dynamicDataKey()
    .replace("Supply", "");

  const path = getScriptFolder(context);
  const allContent = JSON.parse(fs.readFileSync(`${path}/data.json`, "utf8"));

  let dataKey = context.data.key;
  const items = util.toArray(context.data.items).map(sketch.fromNative);
  items.forEach((item, index) => {
    let data = allContent[dataRow].randomElement();
    DataSupplier.supplyDataAtIndex(dataKey, data, index);
  });
}

export function linkSpreadsheet(context) {
  let sheet = getPreferences("sheetID");
  if (sheet) return;

  sketch.UI.getInputFromUser(
    "Google Sheets URL",
    { initialValue: "Appleseed" },
    (err, value) => {
      if (err) {
        // most likely the user canceled the input
        return;
      } else {
        let sheetID = validateURL(value);
        console.log(sheetID);
        if (sheetID) {
          setPreferences("sheetID", sheetID);
        } else {
          sketch.UI.message("Invalid URL");
        }
      }
    }
  );

  //getNewContent();
}

export function getNewContent() {
  //DataSupplier.deregisterDataSuppliers();
  syncContent();

  //AppController.sharedInstance().applicationWillTerminate(AppController.id);

  // const pm = AppController.sharedInstance().pluginManager();
  // const plugin = pm.plugins()["Content"];
  // if (plugin) {
  //   pm.disablePlugin_(plugin);
  //   pm.enablePlugin_(plugin);
  //   pm.reloadPlugins();
  // }
}
