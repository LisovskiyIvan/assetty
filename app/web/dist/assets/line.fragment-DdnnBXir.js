import{b6 as e}from"./index-BwCexCOg.js";import{clipPlaneFragmentDeclaration as a}from"./clipPlaneFragmentDeclaration-BBudgrpz.js";import{logDepthDeclaration as i}from"./logDepthDeclaration-DKQA9WNb.js";import{l}from"./logDepthFragment-BdbWL8Dw.js";import{clipPlaneFragment as t}from"./clipPlaneFragment-1fp-CdOF.js";import"./objectIdFunctions-LK1jBm3Z.js";const o="linePixelShader",n=`#include<clipPlaneFragmentDeclaration>
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
