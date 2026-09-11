import {readFile, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const environmentPath = path.join(root, "functions", ".env.simple-books-office");
const enabled = "STRIPE_CHECKOUT_ENABLED=true";
const disabled = "STRIPE_CHECKOUT_ENABLED=false";
const source = await readFile(environmentPath, "utf8");

if(source.includes(disabled) && !source.includes(enabled)){
  console.log("Production Functions checkout is already disabled.");
} else {
  if(source.split(enabled).length !== 2 || source.includes(disabled)){
    throw new Error("Production checkout flag boundary is not exactly enabled once");
  }
  await writeFile(environmentPath, source.replace(enabled, disabled));
  console.log("Production Functions checkout flag set to disabled; redeploy createCheckoutSession to apply.");
}
