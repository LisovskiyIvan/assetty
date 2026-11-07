import{b6 as e}from"./index-CTe2nUuT.js";import{clipPlaneFragmentDeclaration as a}from"./clipPlaneFragmentDeclaration-rSRkesLQ.js";import{logDepthDeclaration as i}from"./logDepthDeclaration-BjOl9tWv.js";import{l}from"./logDepthFragment-CXKfaZ6J.js";import{clipPlaneFragment as t}from"./clipPlaneFragment-CwM4aahZ.js";import"./objectIdFunctions-BacwsEIr.js";const o="linePixelShader",n=`#include<clipPlaneFragmentDeclaration>
uniform vec4 color;
#ifdef LOGARITHMICDEPTH
#extension GL_EXT_frag_depth : enable
#endif
#include<logDepthDeclaration>
#define CUSTOM_FRAGMENT_DEFINITIONS
void main(void) {
#define CUSTOM_FRAGMENT_MAIN_BEGIN
#include<logDepthFragment>
#include<clipPlaneFragment>
gl_FragColor=color;
#define CUSTOM_FRAGMENT_MAIN_END
}`;e.ShadersStore[o]||(e.ShadersStore[o]=n);const c=[a,i,l,t];for(const r of c)e.IncludesShadersStore[r.name]||(e.IncludesShadersStore[r.name]=r.shader);const h={name:o,shader:n};export{h as linePixelShader};
