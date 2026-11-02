import{b6 as e}from"./index-BncxKkTR.js";import{clipPlaneFragmentDeclaration as a}from"./clipPlaneFragmentDeclaration-D_tRQWT9.js";import{logDepthDeclaration as i}from"./logDepthDeclaration-D_anRqDd.js";import{l}from"./logDepthFragment-BOHoRnWb.js";import{clipPlaneFragment as t}from"./clipPlaneFragment-B0bS7Fx6.js";import"./objectIdFunctions-CQVCtc6x.js";const o="linePixelShader",n=`#include<clipPlaneFragmentDeclaration>
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
