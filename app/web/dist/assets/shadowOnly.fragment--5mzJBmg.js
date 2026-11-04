import{b6 as e}from"./index-CgKvOhs2.js";import{s as r}from"./sceneUboDeclaration-CVBFTIjj.js";import{helperFunctionsWGSL as i}from"./helperFunctions-DqFI9Azi.js";import{l as t,s as l}from"./shadowsFragmentFunctions-BD6L5s6w.js";import{l as s}from"./lightsFragmentFunctions-Buou8aXu.js";import{c as f,a as m}from"./clipPlaneFragment-B81PoMGm.js";import{logDepthDeclarationWGSL as c}from"./logDepthDeclaration-BlrVtrmE.js";import{fogFragmentDeclarationWGSL as d}from"./fogFragmentDeclaration-E-xKICur.js";import{lightFragmentWGSL as g}from"./lightFragment-WZDGdMBm.js";import{l as S}from"./logDepthFragment-BmD_lqfL.js";import{f as u}from"./fogFragment-IcTz2xB9.js";import"./clusteredLightingFunctions-BfP7C0ZM.js";const a="shadowOnlyPixelShader",o=`#include<sceneUboDeclaration>
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
