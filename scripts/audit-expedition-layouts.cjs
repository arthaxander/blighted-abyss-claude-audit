process.env.NODE_ENV='test';process.env.BABEL_ENV='test';
const root=require('path').resolve(__dirname, '..');
const babel=require('@babel/core');
const loader=require.extensions['.js'];
require.extensions['.js']=(m,f)=>{
 if(!f.startsWith(root+'/src/'))return loader(m,f);
 let source=f;
 const code=babel.transformFileSync(source,{babelrc:false,configFile:false,presets:[root+'/node_modules/babel-preset-react-app'],sourceMaps:false}).code;m._compile(code,f);
};
const layouts=require(root+'/src/utils/expeditionMapLayout.js');
const {createExpeditionMapRun}=require(root+'/src/utils/expeditionMapRun.js');
const {createSeededSimulationRng}=require(root+'/src/utils/simulationRng.js');
const templates=layouts.LOCATION_HEX_TEMPLATES;
const output=[];
for(const t of templates){
 const agg={approach:[],sublocation:[],depth:[]}, types={};
 for(let seed=0;seed<300;seed++){
  const run=createExpeditionMapRun({locationId:t.locationId,abyssLevel:1,templateId:t.id,rng:createSeededSimulationRng(seed)});
  for(const phase of Object.keys(agg)){
   const groups=phase==='sublocation'?run.state.availableSublocationIds.map(id=>run.mainLayout.cells.filter(c=>c.region===phase&&c.sublocationId===id&&c.significant)):[run.mainLayout.cells.filter(c=>c.region===phase&&c.significant)];
   for(const cells of groups){
    agg[phase].push(cells.filter(c=>['COMBAT','CURSED_ENEMY'].includes(c.previewRoomType)).length);
    for(const c of cells){const key=phase+':'+c.previewRoomType;types[key]=(types[key]||0)+1;}
   }
  }
 }
 const summary=Object.fromEntries(Object.entries(agg).map(([p,counts])=>{counts.sort((a,b)=>a-b);return [p,{mean:Math.round(counts.reduce((a,b)=>a+b,0)/counts.length*100)/100,p10:counts[Math.floor(counts.length*.1)],p90:counts[Math.floor(counts.length*.9)],min:counts[0],max:counts.at(-1)}]}));
 output.push({id:t.id,summary,meanTypes:Object.fromEntries(Object.entries(types).map(([k,v])=>[k,Math.round(v/(k.startsWith('sublocation:')?900:300)*100)/100]))});
}
console.log(JSON.stringify({floor:1,seeds:[0,299],reports:output},null,2));
