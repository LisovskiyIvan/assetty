import{b6 as e}from"./index-DTUGP53x.js";import{clipPlaneFragmentDeclaration as a}from"./clipPlaneFragmentDeclaration-BfnCXhrq.js";import{logDepthDeclaration as i}from"./logDepthDeclaration-DBXuoV66.js";import{l}from"./logDepthFragment-CGo1hzci.js";import{clipPlaneFragment as t}from"./clipPlaneFragment-DFdEwMw-.js";import"./objectIdFunctions-CkhkoMol.js";const o="linePixelShader",n=`#include<clipPlaneFragmentDeclaration>
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
