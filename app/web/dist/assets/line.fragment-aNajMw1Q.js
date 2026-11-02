import{b6 as e}from"./index-BW7gnprn.js";import{clipPlaneFragmentDeclaration as a}from"./clipPlaneFragmentDeclaration-Dr2dW4lH.js";import{logDepthDeclaration as i}from"./logDepthDeclaration-JcL19lVh.js";import{l}from"./logDepthFragment-DQOL81KV.js";import{clipPlaneFragment as t}from"./clipPlaneFragment-CRC8pJwZ.js";import"./objectIdFunctions-vZMR96fL.js";const o="linePixelShader",n=`#include<clipPlaneFragmentDeclaration>
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
