import{b6 as r}from"./index-D8wS8RSU.js";const o="fogFragment",e=`#ifdef FOG
var fog: f32=CalcFogFactor();
#ifdef PBR
fog=toLinearSpace(fog);
#endif
color= vec4f(mix(uniforms.vFogColor,color.rgb,fog),color.a);
#endif
`;r.IncludesShadersStoreWGSL[o]||(r.IncludesShadersStoreWGSL[o]=e);const a={name:o,shader:e};export{a as f};
