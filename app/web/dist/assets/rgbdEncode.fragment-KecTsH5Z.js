import{S as e}from"./index-14bN2E_8.js";import{h as t}from"./helperFunctions-BCjtAZZc.js";const o="rgbdEncodePixelShader",n=`varying vec2 vUV;uniform sampler2D textureSampler;
#include<helperFunctions>
#define CUSTOM_FRAGMENT_DEFINITIONS
void main(void) 
{gl_FragColor=toRGBD(texture2D(textureSampler,vUV).rgb);}`;e.ShadersStore[o]||(e.ShadersStore[o]=n);const a=[t];for(const r of a)e.IncludesShadersStore[r.name]||(e.IncludesShadersStore[r.name]=r.shader);const i={name:o,shader:n};export{i as rgbdEncodePixelShader};
