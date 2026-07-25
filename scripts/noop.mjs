const [command = "noop", scope = "workspace"] = process.argv.slice(2);

console.log(`${command}: ${scope} has no implementation in the current scaffold`);
