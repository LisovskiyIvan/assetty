import{b6 as e}from"./index-BwCexCOg.js";import{helperFunctions as i}from"./helperFunctions-DnpwHqlX.js";const o="lodPixelShader",a=`precision highp float;
#ifndef USE_EXACT_SRGB_CONVERSIONS
#define USE_EXACT_SRGB_CONVERSIONS
#endif
#include<helperFunctions>
varying vec2 vUV;uniform sampler2D textureSampler;uniform float lod;uniform vec2 texSize;uniform int gamma; 
void main(void)
{ivec2 textureDimensions=textureSize(textureSampler,0);gl_FragColor=texelFetch(textureSampler,ivec2(vUV*vec2(textureDimensions)),int(lod));if (gamma==0) {gl_FragColor.rgb=pow(gl_FragColor.rgb,vec3(GammaEncodePowerApprox));} else if (gamma==2) {gl_FragColor.rgb=toGammaSpaceExact(gl_FragColor.rgb);}}
`;e.ShadersStore[o]||(e.ShadersStore[o]=a);const t=[i];for(const r of t)e.IncludesShadersStore[r.name]||(e.IncludesShadersStore[r.name]=r.shader);const m={name:o,shader:a};export{m as lodPixelShader};
