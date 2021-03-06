let assert = require('assert');
let path = require('path');

let fs = require('q-io/fs');
let VError = require('verror');
let Q = require('q');
Q.longStackSupport = true;

let utils = require('./utils');
let { getElement } = require('./element');
let {
  addElementContext,
  addDemoElementContext
} = require('./add-element-context');

let baseDir = path.dirname(__dirname);

// NOTE: this is like `getElement` method and it should be put in its
// own file but since the function is so small keeping it here for now
function getCategory(cat) {
  assert(utils.isObject(cat), 'category has to be an object');

  let { name, displayName } = cat;
  assert(utils.isString(name), 'category name has to be a string');
  utils.ifPresentCheckType('string', 'display name', utils.displayName);

  cat = {};
  cat.name = name;
  cat.displayName = displayName;

  return cat;
}

function validateConfig(cfg) {
  let types = {
    'baseurl': 'string',
    'elements': 'array',
    'categories': 'array',
    'showDemoTester': 'boolean',
    'absoluteBaseurl': 'string',
    'footerText': 'string',
    'markdownExtensions': 'array',
    'siteName': 'string',
    'brandColor': 'string',
    'showBuildStatus': 'boolean',
  };

  for (let key of Object.keys(types)) {
    utils.ifPresentCheckType(types[key], key, cfg[key]);
  }
}

/**
 * Check if the array has two object with same value for a certain key
 * TODO: this is a general purpose function. keep it here?
 * @param  {Array}  arr  The array to search for
 * @param  {String} key  The key to use for getting the value
 * @param  {String} name Name to use in message
 * @return {undefined}
 */
function validateUnique(arr, key, name) {
  let hash = {};

  for (let item of arr) {
    if (!hash[item[key]]) {
      hash[item[key]] = true;
    } else {
      assert(false, `${name} have to be unique. duplicate: ${item[key]}`);
    }
  }
}

/**
 * Validate if the categories for each element is indeed present
 * @param  {Array} elements   Array of elements
 * @param  {Array} categories Array of categories
 * @return {undefined}
 */
function validateElementCategories(elements, categories) {
  let catNames = categories.map(cat => cat.name);

  for (let el of elements) {
    if (el.category && catNames.indexOf(el.category) === -1) {
      assert(false, `no category ${el.category} found for element ${el.name}`);
    }
  }
}

/**
 * Add a propertry `elements` on each category, pointing to its elements
 * @param  {Array} elements   Array of elements
 * @param  {Array} categories Array of categories
 * @return {undefined}
 */
function linkElementsWithCategories(elements, categories) {
  return categories.map(cat => {
    let catElements = elements.filter(el => el.category === cat.name);
    catElements.forEach((el, index) => el.indexInCategory = index);
    cat.elements = catElements;

    return cat;
  });
}

/**
 * Read and parse the `metadata.json` file.
 * @return {undefined}
 */
let getBaseConfig = Q.async(function* () {
  let filePath = 'metadata.json', config;

  try {
    config = yield fs.read(filePath);
    config = JSON.parse(config);

    return config;
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new VError(err, 'Not a valid json file. Parsing metadata.json failed');
    }
    else if (err.code === 'ENOENT') {
      throw new VError(err, 'No metadata.json file present in the current directory');
    }
    else {
      throw err;
    }
  }
});

/**
 * Get the config object with default values set and other override
 * values updated. Also, validate the input config.
 * @param  {Object} config     The config object
 * @param  {Object} argvConfig The config from command line
 * @return {Object}            The config object
 */
function getDefaultConfig(config, argvConfig) {
  let defaultConfig = {
    _includesDir: path.resolve(baseDir, 'includes'),
    _layoutsDir: path.resolve(baseDir, 'layouts'),
    _pagesDir: path.resolve(baseDir, 'pages'),
    _templatesDir: path.resolve(baseDir, 'templates'),
    _devEnv: false,
    baseurl: '',
    elements: [],
    categories: [],
    showDemoTester: true,
    siteName: 'Docs',
    brandColor: '#07C5F2',
    // TODO: decide default values for next 2 entries
    absoluteBaseurl: undefined,
    footerText: undefined,
    showBuildStatus: true,
    markdownExtensions: ['.md']
  };

  if (config !== undefined) {
    assert(utils.isObject(config), 'config has to be an object');
  }

  // the `assign` method takes of `undefined` arguments
  // TODO: should we check for bad argument `argvConfig` here?
  config = Object.assign({}, defaultConfig, config, argvConfig);

  validateConfig(config);

  if (config.showDemoTester) {
    config.elements.push({
      'name': 'demo-tester',
      'displayName': 'Demo Tester',
      'install': path.resolve(baseDir, 'demo-tester')
    });
  }

  return config;
}

/**
 * Validate and get the config object.
 * @param {Object} argvConfig config from command line
 * @return {Object}            the config object
 */
let getConfig = Q.async(function* (argvConfig) {
  let config, elements, categories;

  try {
    config = yield getBaseConfig();
    config = getDefaultConfig(config, argvConfig);

    elements = config.elements.map(el => getElement(el));
    elements = yield Promise.all(elements);
    categories = config.categories.map(cat => getCategory(cat));

    validateUnique(elements, 'name', 'element names');
    // TODO: change the assertion message or do something else?
    validateUnique(elements, 'pageDirName', 'element display names');
    validateUnique(categories, 'name', 'category names');
    validateElementCategories(elements, categories);

    categories = linkElementsWithCategories(elements, categories);
    elementsWithDemo = elements.filter(el => !el.disableDemo);

    config.elements = elements;
    config.categories = categories;
    config.totalElements = elements.length - (config.showDemoTester ? 1 : 0);
    config.elementsWithDemo = elementsWithDemo;
  } catch (err) {
    if (err instanceof assert.AssertionError ||
        err instanceof VError) {

      throw err;
    }

    throw new VError(err, 'Not a valid metadata.json file');
  }

  return config;
});

/**
 * Add more properties on the config object
 * @param {Object} config The config object
 * @param {Array}  pages  Array of glob patterns
 * @return {Object}        The config object
 */
let getFullConfig = Q.async(function* (config, pages) {
  let { baseurl, showBuildStatus } = config;
  yield addElementContext(config.elements, baseurl, showBuildStatus);
  yield addDemoElementContext(config.elementsWithDemo, baseurl, showBuildStatus);

  config.pagesMenu = pages
    .filter(p => p.name !== 'index')
    .map(p => {
      p.url = `${config.baseurl}/${p.name}/`;
      p.title = utils.fromDashCase(p.name);

      return p;
    })
    .sort((a, b) => a.name > b.name);

  return config;
});

/**
 * Adds an element to the `metadata.json`
 * @param {Object} el The element config object to add
 * @return {Promise}   Resolves when `metadata.json` is written
 */
let addElement = Q.async(function* (el) {
  let config = yield getBaseConfig();
  config.elements = config.elements || [];
  config.elements.push(el);

  return fs.write('metadata.json', JSON.stringify(config, null, 4));
});

module.exports = {
  getCategory: getCategory,

  validateConfig: validateConfig,
  validateUnique: validateUnique,
  validateElementCategories: validateElementCategories,

  linkElementsWithCategories: linkElementsWithCategories,

  getBaseConfig: getBaseConfig,
  getDefaultConfig: getDefaultConfig,
  getConfig: getConfig,
  getFullConfig: getFullConfig,
  addElement: addElement
};
