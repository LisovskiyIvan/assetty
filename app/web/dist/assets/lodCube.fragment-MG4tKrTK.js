import{b6 as e}from"./index-CTe2nUuT.js";import{helperFunctions as a}from"./helperFunctions-CtJ-WWSu.js";const o="lodCubePixelShader",l=`precision highp float;
#ifndef USE_EXACT_SRGB_CONVERSIONS
#define USE_EXACT_SRGB_CONVERSIONS
#endif
#include<helperFunctions>
varying vec2 vUV;uniform samplerCube textureSampler;uniform float lod;uniform int gamma; 
void main(void)
{vec2 uv=vUV*2.0-1.0;
#ifdef POSITIVEX
gl_FragColor=textureCube(textureSampler,vec3(1.001,uv.y,uv.x),lod);
#endif
#ifdef NEGATIVEX
gl_FragColor=textureCube(textureSampler,vec3(-1.001,uv.y,uv.x),lod);
#endif
#ifdef POSITIVEY
gl_FragColor=textureCube(textureSampler,vec3(uv.y,1.001,uv.x),lod);
#endif
#ifdef NEGATIVEY
gl_FragColor=textureCube(textureSampler,vec3(uv.y,-1.001,uv.x),lod);
#endif
#ifdef POSITIVEZ
gl_FragColor=textureCube(textureSampler,vec3(uv,1.001),lod);
#endif
#ifdef NEGATIVEZ
gl_FragColor=textureCube(textureSampler,vec3(uv,-1.001),lod);
#endif
if (gamma==0) {gl_FragColor.rgb=pow(gl_FragColor.rgb,vec3(GammaEncodePowerApprox));} else if (gamma==2) {gl_FragColor.rgb=toGammaSpaceExact(gl_FragColor.rgb);}}
`;e.ShadersStore[o]||(e.ShadersStore[o]=l);const t=[a];for(const r of t)e.IncludesShadersStore[r.name]||(e.IncludesShadersStore[r.name]=r.shader);const i={name:o,shader:l};export{i as lodCubePixelShader};
