import{b6 as e}from"./index-7F-5godA.js";import{helperFunctions as t}from"./helperFunctions-Dp0O-sSN.js";const o="rgbdDecodePixelShader",n=`varying vec2 vUV;uniform sampler2D textureSampler;
#include<helperFunctions>
#define CUSTOM_FRAGMENT_DEFINITIONS
void main(void) 
{gl_FragColor=vec4(fromRGBD(texture2D(textureSampler,vUV)),1.0);}`;e.ShadersStore[o]||(e.ShadersStore[o]=n);const d=[t];for(const r of d)e.IncludesShadersStore[r.name]||(e.IncludesShadersStore[r.name]=r.shader);const i={name:o,shader:n};export{i as rgbdDecodePixelShader};
