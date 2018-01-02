const puppeteer = require('puppeteer');
const chalk = require('chalk');
const {
  existsSync, mkdirSync, createWriteStream,
} = require('fs');
const { join } = require('path');
const resemble = require('node-resemble-js');
const { environments, paths } = require('./config');

function compare(src, dest) {
  const onlySrc = [];
  const onlyDest = [];
  const match = [];

  src.forEach((_, key) => {
    if (dest.has(key)) {
      match.push(key);
    } else {
      onlySrc.push(key);
    }
  });

  dest.forEach((_, key) => {
    if (!src.has(key)) {
      onlyDest.push(key);
    }
  });

  return {
    onlySrc,
    onlyDest,
    match,
  };
}

async function handleEnvironment(environment, browser, resultsDir, path) {
  const page = await browser.newPage();

  await page.goto(`${environment.path}/${path}`);

  const windowHandle = await page.evaluateHandle('window');
  const jqueryPluginHandle = await page.evaluateHandle('jQuery.fn');

  const screenshot = await page.screenshot({
    path: `${resultsDir}/${environment.name}.png`,
    fullPage: true,
  });

  const { width, height } = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    height: document.documentElement.scrollHeight,
  }));

  return {
    windowHandle,
    jqueryPluginHandle,
    screenshot,
    width,
    height,
  };
}

async function handlePath(path, browser) {
  const resultsDir = join(__dirname, 'results', encodeURIComponent(path));
  if (!existsSync(resultsDir)) {
    mkdirSync(resultsDir);
  }

  const data = new Map(await Promise.all(Object.entries(environments)
    .map(async ([key, value]) => [key, handleEnvironment(value, browser, resultsDir, path)])));

  const production = await data.get('production');
  const staging = await data.get('staging');

  const windowCompare = compare(
    await production.windowHandle.getProperties(),
    await staging.windowHandle.getProperties(),
  );
  const jQueryCompare = compare(
    await production.jqueryPluginHandle.getProperties(),
    await staging.jqueryPluginHandle.getProperties(),
  );

  const result = await new Promise((resolve) => {
    resemble(staging.screenshot)
      .compareTo(production.screenshot)
      .onComplete((d) => {
        d.getDiffImage().pack().pipe(createWriteStream(`${resultsDir}/diff.png`));
        resolve(d);
      });
  });

  console.log(chalk`
{underline.magentaBright /${path}}
  {bold.green window}:
    {underline.green only in production:}
      {redBright ${windowCompare.onlyDest.join('\n      ')}}
    {underline.green only in staging:}
      {yellowBright ${windowCompare.onlySrc.join('\n      ')}}`);

  console.log(chalk`
{underline.magentaBright /${path}}
  {bold.green jQuery.fn}:
    {underline.green only in production:}
      {redBright ${jQueryCompare.onlyDest.join('\n      ')}}
    {underline.green only in staging:}
      {yellowBright ${jQueryCompare.onlySrc.join('\n      ')}}`);

  return result;
}

async function launch() {
  const browser = await puppeteer.launch({
    ignoreHTTPSErrors: true,
    dumpio: false,
  });

  if (!existsSync(join(__dirname, 'results'))) {
    mkdirSync(join(__dirname, 'results'));
  }

  await Promise.all(paths.map(path => handlePath(path, browser)));

  await browser.close();
}

launch();
