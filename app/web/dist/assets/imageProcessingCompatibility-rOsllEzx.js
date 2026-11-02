import{b6 as t}from"./index-CObigdMN.js";const e="imageProcessingCompatibility",o=`#ifdef IMAGEPROCESSINGPOSTPROCESS
fragmentOutputs.color=vec4f(pow(fragmentOutputs.color.rgb, vec3f(2.2)),fragmentOutputs.color.a);
#endif
`;t.IncludesShadersStoreWGSL[e]||(t.IncludesShadersStoreWGSL[e]=o);const s={name:e,shader:o};export{s as i};
