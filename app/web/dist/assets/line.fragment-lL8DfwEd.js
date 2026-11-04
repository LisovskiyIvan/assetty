import{b6 as e}from"./index-CgKvOhs2.js";import{clipPlaneFragmentDeclaration as a}from"./clipPlaneFragmentDeclaration-DuskL_HJ.js";import{logDepthDeclaration as i}from"./logDepthDeclaration-bRLsqemr.js";import{l}from"./logDepthFragment-D6Os50wl.js";import{clipPlaneFragment as t}from"./clipPlaneFragment-DYA69fpu.js";import"./objectIdFunctions-KahJYEdP.js";const o="linePixelShader",n=`#include<clipPlaneFragmentDeclaration>
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
