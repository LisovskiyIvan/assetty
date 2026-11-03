import{b6 as e}from"./index-Bsw09bT6.js";import{c as t,a as o}from"./clipPlaneFragment-FxOn6I2G.js";import{logDepthDeclarationWGSL as i}from"./logDepthDeclaration-CJZrA-cO.js";import{l}from"./logDepthFragment-D514kfxB.js";const r="linePixelShader",a=`#include<clipPlaneFragmentDeclaration>
uniform color: vec4f;
#include<logDepthDeclaration>
#define CUSTOM_FRAGMENT_DEFINITIONS
@fragment
fn main(input: FragmentInputs)->FragmentOutputs {
#define CUSTOM_FRAGMENT_MAIN_BEGIN
#include<logDepthFragment>
#include<clipPlaneFragment>
fragmentOutputs.color=uniforms.color;
#define CUSTOM_FRAGMENT_MAIN_END
}`;e.ShadersStoreWGSL[r]||(e.ShadersStoreWGSL[r]=a);const c=[t,i,l,o];for(const n of c)e.IncludesShadersStoreWGSL[n.name]||(e.IncludesShadersStoreWGSL[n.name]=n.shader);const f={name:r,shader:a};export{f as linePixelShaderWGSL};
