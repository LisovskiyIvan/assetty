import{b6 as e}from"./index-Co7RwRrn.js";import{s as r}from"./sceneUboDeclaration-C66HR82G.js";import{helperFunctionsWGSL as i}from"./helperFunctions-s6SJOF6i.js";import{l as t,s as l}from"./shadowsFragmentFunctions-B05l8PN8.js";import{l as s}from"./lightsFragmentFunctions-CpwBtV1N.js";import{c as f,a as m}from"./clipPlaneFragment-Cpoj4go7.js";import{logDepthDeclarationWGSL as c}from"./logDepthDeclaration-Y3X_tSgf.js";import{fogFragmentDeclarationWGSL as d}from"./fogFragmentDeclaration-EbmDQUjL.js";import{lightFragmentWGSL as g}from"./lightFragment-RnhlhWmE.js";import{l as S}from"./logDepthFragment-CWKIDxm_.js";import{f as u}from"./fogFragment-DRmnm9Vf.js";import"./clusteredLightingFunctions-DQFwE3-Q.js";const a="shadowOnlyPixelShader",o=`#include<sceneUboDeclaration>
uniform alpha: f32;uniform shadowColor: vec3f;
#define ADDITIONAL_UBO_DECLARATION
varying vPositionW: vec3f;
#ifdef NORMAL
varying vNormalW: vec3f;
#endif
#include<helperFunctions>
#include<lightUboDeclaration>[0..maxSimultaneousLights]
#include<lightsFragmentFunctions>
#include<shadowsFragmentFunctions>
#include<clipPlaneFragmentDeclaration>
#include<logDepthDeclaration>
#include<fogFragmentDeclaration>
#if defined(CLUSTLIGHT_BATCH) && CLUSTLIGHT_BATCH>0
varying vViewDepth: f32;
#endif
#define CUSTOM_FRAGMENT_DEFINITIONS
@fragment
fn main(input: FragmentInputs)->FragmentOutputs {
#define CUSTOM_FRAGMENT_MAIN_BEGIN
#include<clipPlaneFragment>
var viewDirectionW: vec3f=normalize(scene.vEyePosition.xyz-fragmentInputs.vPositionW);
#ifdef NORMAL
var normalW: vec3f=normalize(fragmentInputs.vNormalW);
#else
var normalW: vec3f= vec3f(1.0,1.0,1.0);
#endif
var diffuseBase: vec3f= vec3f(0.,0.,0.);var info: lightingInfo;var shadow: f32=1.;var glossiness: f32=0.;var aggShadow: f32=0.;var numLights: f32=0.;
#include<lightFragment>[0..1]
#define CUSTOM_FRAGMENT_BEFORE_LIGHT_COMPOSITION
var color: vec4f= vec4f(uniforms.shadowColor,(1.0-clamp(shadow,0.,1.))*uniforms.alpha);
#include<logDepthFragment>
#include<fogFragment>
fragmentOutputs.color=color;
#define CUSTOM_FRAGMENT_MAIN_END
}
`;e.ShadersStoreWGSL[a]||(e.ShadersStoreWGSL[a]=o);const h=[r,i,t,s,l,f,c,d,m,g,S,u];for(const n of h)e.IncludesShadersStoreWGSL[n.name]||(e.IncludesShadersStoreWGSL[n.name]=n.shader);const A={name:a,shader:o};export{A as shadowOnlyPixelShaderWGSL};
