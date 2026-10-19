const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require(process.env.FOODMASTER_TYPESCRIPT||'typescript');
const mod={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.resolve(__dirname,'../../miniprogram/utils/quantity-format.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{module:mod,exports:mod.exports});
module.exports=mod.exports;
