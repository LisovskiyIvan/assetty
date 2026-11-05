import{b6 as s}from"./index-D5UMdsmS.js";const e="fogVertex",o=`#ifdef FOG
#ifdef SCENE_UBO
vertexOutputs.vFogDistance=(scene.view*worldPos).xyz;
#else
vertexOutputs.vFogDistance=(uniforms.view*worldPos).xyz;
#endif
#endif
`;s.IncludesShadersStoreWGSL[e]||(s.IncludesShadersStoreWGSL[e]=o);const r={name:e,shader:o};export{r as f};
