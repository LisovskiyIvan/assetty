import{b6 as e}from"./index-nL-PFW8x.js";import{clipPlaneFragmentDeclaration as a}from"./clipPlaneFragmentDeclaration-CuFPiREC.js";import{logDepthDeclaration as i}from"./logDepthDeclaration-vknM5Iv1.js";import{l}from"./logDepthFragment-BJ_1d8Se.js";import{clipPlaneFragment as t}from"./clipPlaneFragment-XDjDOoPK.js";import"./objectIdFunctions-B2rPE3AU.js";const o="linePixelShader",n=`#include<clipPlaneFragmentDeclaration>
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
