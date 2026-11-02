import{S as e}from"./index-14bN2E_8.js";import"./objectIdFunctions-Blml9mya.js";const n="prePassDeclaration",f=`#ifdef PREPASS
#ifndef PREPASS_CUSTOM_VARYINGS
#ifdef PREPASS_LOCAL_POSITION
varying vPosition : vec3f;
#endif
#ifdef PREPASS_DEPTH
varying vViewPos: vec3f;
#endif
#ifdef PREPASS_NORMALIZED_VIEW_DEPTH
varying vNormViewDepth: f32;
#endif
#if (defined(PREPASS_VELOCITY) || defined(PREPASS_VELOCITY_LINEAR)) && !defined(PREPASS_VELOCITY_ZERO)
varying vCurrentPosition: vec4f;varying vPreviousPosition: vec4f;
#endif
#endif
#ifdef PREPASS_OBJECT_ID
uniform objectId: f32;
#include<objectIdFunctions>
#endif
#ifdef PREPASS_MESH_BLEND_TAG
uniform meshBlendTag: i32;
#endif
#endif
`;e.IncludesShadersStoreWGSL[n]||(e.IncludesShadersStoreWGSL[n]=f);const s={name:n,shader:f},t="logDepthFragment",i=`#ifdef LOGARITHMICDEPTH
fragmentOutputs.fragDepth=log2(fragmentInputs.vFragmentDepth)*uniforms.logarithmicDepthConstant*0.5;
#endif
`;e.IncludesShadersStoreWGSL[t]||(e.IncludesShadersStoreWGSL[t]=i);const o={name:t,shader:i},a="meshBlendTagFragmentOutput",S=`#if SCENE_MRT_COUNT>{X}
#if defined(PREPASS_MESH_BLEND_TAG) && PREPASS_MESH_BLEND_TAG_INDEX=={X}
fragmentOutputs.fragData{X}=meshBlendTagOutput;
#else
fragmentOutputs.fragData{X}=fragData[{X}];
#endif
#endif
`;e.IncludesShadersStoreWGSL[a]||(e.IncludesShadersStoreWGSL[a]=S);const P={name:a,shader:S};export{o as l,P as m,s as p};
